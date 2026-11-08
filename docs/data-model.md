# Модель данных: полная трассировка

Аудит всех полей, запросов и ответов против ТЗ. Документ отвечает на один
вопрос: есть ли место, где данные теряются, недовалидируются или
недоопределены. Находки — в разделе 10.

## 1. Карта потоков

```
   RabbitMQ                                   HTTP
   bet.settled ──┐                     GET /leaderboard ──┐
   bet.rollback ─┤                     GET /health ───────┤
                 ▼                     GET /metrics ──────┤
         BetEventProcessor                                ▼
         (валидация + нормализация)              LeaderboardService
                 │ SettleBetCommand                       │ LeaderboardQuery
                 │ RollbackBetCommand                     ▼
                 ▼                                 PlayerScoresRepository
           ScoringService ──► UnitOfWork ──► bets, player_scores
                 │                                        │
                 │ SettleOutcome / RollbackOutcome         ▼
                 ▼                                   LeaderboardView
        BetEventsConsumer ──► ack / retry-хоп / tournament.parked
                 │
                 └──► MetricsPort ──► GET /metrics
```

Источники истины: **конфиг** — окно турнира и курсы; **`bets`** — что произошло
со ставкой и сколько она дала очков; **`player_scores`** — производный агрегат,
восстановимый из `bets`.

---

## 2. Вход: события очереди

### 2.1 `bet.settled` → `BetSettledEventDto` → `SettleBetCommand`

| Поле | В payload | Валидация | В домене | В БД | Роль |
|---|---|---|---|---|---|
| `betId` | string | `@IsUUID` | `string` | `bets.bet_id` (uuid, часть PK) | ключ идемпотентности |
| `playerId` | string | `@IsUUID` | `string` | `bets.player_id`, `player_scores.player_id` | кому очки |
| `currency` | string | `^[A-Z]{3}$` | `string` | `bets.currency` char(3) | поиск курса |
| `stake` | string \| number | `@IsMoneyAmount` | `Decimal` | `bets.stake` numeric(20,4) | только аудит |
| `winAmount` | string \| number | `@IsMoneyAmount` | `Decimal` | `bets.win_amount` numeric(20,4) | **база очков** |
| `settledAt` | string | `@IsIsoTimestamp` (зона обязательна) | `Date` | `bets.settled_at` timestamptz | окно турнира + тай-брейк |

Производные, которых в событии нет:

| Поле | Откуда | В БД |
|---|---|---|
| `fxRate` | `FxPort.rateFor(currency)` на момент обработки | `bets.fx_rate` numeric(20,8) |
| `pointsAwarded` | `toPoints(winAmount, fxRate)` | `bets.points_awarded` numeric(20,6) |
| `tournamentId` | активный турнир из конфига | `bets.tournament_id` |
| `status` | `settled` (или `rolled_back`, если было надгробие) | `bets.status` |

Реакция на нарушения:

| Нарушение | Реакция |
|---|---|
| не JSON / не объект | парковка, `invalid_schema` |
| `betId`/`playerId` не UUID | парковка, `invalid_schema` |
| `currency` не 3 заглавные буквы | парковка, `invalid_schema` |
| суммы: отрицательные, >4 знаков, >1e12, экспонента, `NaN` | парковка, `amount_out_of_range` |
| `settledAt` без зоны или не ISO | парковка, `invalid_schema` |
| `currency` валиден, но курса нет в конфиге | парковка, `unknown_currency` |
| `winAmount × курс` > 99999999999999.999999 | парковка, `amount_out_of_range` |
| `settledAt` вне окна турнира | **ack, 0 очков**, метрика `out_of_window` |
| ставка уже в журнале | **ack**, `duplicate` |
| ставка уже откатана (надгробие) | **ack**, `already_rolled_back`, аудит дозаполняется |
| БД недоступна / deadlock | retry-хоп, после 5 попыток парковка |

### 2.2 `bet.rollback` → `BetRollbackEventDto` → `RollbackBetCommand`

| Поле | В payload | Валидация | В команде | Почему |
|---|---|---|---|---|
| `betId` | string, обязателен | `@IsUUID` | **есть** | единственный адрес отката |
| `playerId` | string, обязателен | `@IsUUID` | **есть** | логи + надгробие |
| `currency` | опционально | `^[A-Z]{3}$` если есть | **нет** | резолв курса отправил бы легитимный откат в парковку |
| `stake` | опционально | `@IsMoneyAmount` если есть | **нет** | не участвует |
| `winAmount` | опционально | `@IsMoneyAmount` если есть | **нет** | вычитаем сохранённое, а не пересчитанное |
| `settledAt` | опционально | `@IsIsoTimestamp` если есть | **нет** | проверка окна проигнорировала бы откат → фантомные очки |

Узость команды — не экономия, а инвариант: в `ScoringService.rollback` просто
нет данных, которыми можно ошибиться.

| Состояние ставки | Реакция | Исход |
|---|---|---|
| `settled` | вычесть `points_awarded`, пересчитать `last_scored_at` | `rolled_back` |
| нет строки | вставить надгробие `rollback_pending` | `tombstoned` |
| `rolled_back` / `rollback_pending` | ничего | `duplicate` |

### 2.3 Конверт AMQP

Читаем: `fields.routingKey` (маршрутизация), `properties.headers['x-death']`
(номер попытки — по `count` на подходящей записи, а не по числу записей).
Пишем при парковке: `x-park-reason`, `x-park-error`, `x-park-routing-key`,
`x-park-attempts`, `x-park-at`. Смоделировано в `amqp-envelope.contract.ts`,
потому что amqplib типизирует заголовки как мешок `any`.

---

## 3. Вход: конфиг

| Переменная | Тип | Валидация | Дефолт |
|---|---|---|---|
| `NODE_ENV` | enum | development \| test \| production | development |
| `PORT` | int | 1..65535 | 3000 |
| `LOG_LEVEL` | enum | fatal…trace | info |
| `LOG_PRETTY` | bool | `"true"`/`"false"` | false |
| `DATABASE_URL` | string | начинается с `postgres://`/`postgresql://` | — |
| `RABBITMQ_URL` | string | начинается с `amqp://`/`amqps://` | — |
| `RABBITMQ_PREFETCH` | int | 1..1000 | 20 |
| `RABBITMQ_MAX_ATTEMPTS` | int | 1..100 | 5 |
| `RABBITMQ_RETRY_TTL_MS` | int | >0 | 10000 |
| `FX_RATES` | JSON-объект | ключ `^[A-Z]{3}$`, значение — положительный десятичный ≤ 1e6, `USD` запрещён | — |
| `TOURNAMENT_CODE` | string | 1..64 | — |
| `TOURNAMENT_STARTS_AT` | date | ISO, включительно | — |
| `TOURNAMENT_ENDS_AT` | date | ISO, строго позже starts | — |

Курсы хранятся строками от самого окружения: JSON-число — это float, а на него
умножаются деньги.

---

## 4. Вход: HTTP

`GET /leaderboard`

| Параметр | Где | Тип | Правила | Дефолт |
|---|---|---|---|---|
| `limit` | query | int | 1..100 | 100 |
| `X-Player-Id` | header | string | UUID, если присутствует | — (нет → `me: null`) |

`GET /health`, `GET /metrics` — без параметров.

---

## 5. Хранение

### `tournaments`
| Колонка | Тип | Ограничения |
|---|---|---|
| `id` | uuid | PK |
| `code` | text | UNIQUE |
| `starts_at` / `ends_at` | timestamptz | `ends_at > starts_at` |
| `created_at` | timestamptz | now() |

### `bets` — журнал ставок и журнал идемпотентности
| Колонка | Тип | Null | Ограничения |
|---|---|---|---|
| `tournament_id`, `bet_id` | uuid | нет | PK, FK на турнир |
| `player_id` | uuid | нет | |
| `status` | text | нет | `settled` \| `rolled_back` \| `rollback_pending` |
| `currency` | char(3) | **да** | NOT NULL при любом статусе, кроме надгробия |
| `stake`, `win_amount` | numeric(20,4) | **да** | ≥ 0; NOT NULL кроме надгробия |
| `fx_rate` | numeric(20,8) | **да** | > 0; NOT NULL кроме надгробия |
| `points_awarded` | numeric(20,6) | нет | ≥ 0; = 0 у надгробия |
| `settled_at` | timestamptz | **да** | NOT NULL кроме надгробия |

Индекс `bets_scoring_by_player_idx (tournament_id, player_id, settled_at DESC)
WHERE status='settled' AND points_awarded>0` — под пересчёт тай-брейка при
откате.

### `player_scores` — агрегат лидерборда
| Колонка | Тип | Null | Ограничения |
|---|---|---|---|
| `tournament_id`, `player_id` | uuid | нет | PK, FK |
| `points` | numeric(20,6) | нет | ≥ 0 |
| `bets_counted` | int | нет | ≥ 0 |
| `last_scored_at` | timestamptz | **да** | `points = 0 OR last_scored_at IS NOT NULL` |
| `updated_at` | timestamptz | нет | |

Индекс `player_scores_leaderboard_idx (tournament_id, points DESC,
last_scored_at ASC NULLS LAST, player_id ASC)` — ровно порядок лидерборда.

`last_scored_at = NULL` означает «никогда не набирал очков»: игрок с одной
проигрышной ставкой и игрок, у которого всё откатили, — в этом состоянии.

---

## 6. Внутренние контракты

| Направление | Тип | Содержит |
|---|---|---|
| в домен | `SettleBetCommand` | betId, playerId, currency, stake: Decimal, winAmount: Decimal, settledAt: Date |
| в домен | `RollbackBetCommand` | betId, playerId — и всё |
| из домена | `SettleOutcome` | `scored{pointsAwarded}` \| `scored_zero` \| `duplicate` \| `already_rolled_back` \| `out_of_window` |
| из домена | `RollbackOutcome` | `rolled_back{pointsRemoved}` \| `tombstoned` \| `duplicate` |
| в репозиторий | `InsertSettledBetInput`, `MarkRolledBackInput`, `InsertTombstoneInput`, `PlayerBetsQuery`, `CreditPointsInput`, `DebitPointsInput`, `DecrementCountedInput`, `TopQuery`, `RankQuery`, `PlayerKey`, `TournamentWindow`, `TournamentCodeQuery` | каждый несёт `scope`, если пишет в транзакции |
| из репозитория | `InsertSettledResult`, `VoidedBet`, `BetRecord`, `PlayerScoreRow`, `TournamentRecord` | не entity ORM |
| транспорт | `IncomingBetEvent`, `FailureContext`, `ParkRequest`, `MessageOutcome` | |

Правило: **в домен входит разобранное** (`Decimal`, `Date`), **из домена выходит
текст** (точные десятичные строки) — он идёт в логи, метрики и HTTP.

---

## 7. Выход: HTTP

### `GET /leaderboard` → 200
```json
{
  "tournament": { "code": "nov-2026", "startsAt": "...", "endsAt": "...", "status": "active" },
  "top": [{ "rank": 1, "playerId": "...", "points": 1532, "pointsExact": "1532.480000", "betsCounted": 41 }],
  "me": { "rank": 1042, "playerId": "...", "points": 87, "pointsExact": "87.120000", "betsCounted": 6 },
  "generatedAt": "2026-11-08T12:00:00.000Z"
}
```

| Поле | Тип | Правило |
|---|---|---|
| `tournament.status` | enum | вычисляется из окна и «сейчас», не хранится |
| `top[].rank` | int | 1-based, уникален: порядок — полный |
| `top[].points` | int | `floor(pointsExact)` |
| `top[].pointsExact` | string | scale 6, `"0.000000"` у нуля |
| `me` | объект \| null | `null` ⟺ заголовка не было |
| `me.rank` | int \| null | **`null` ⟺ `points = 0`** |

Три состояния `me`, которые раньше путались: нет заголовка → `null`; игрок без
очков (строки нет или всё откатано) → нули и `rank: null`; игрок с очками →
позиция, даже если он вне топ-100.

### 400 / 503
`limit` вне 1..100 или битый `X-Player-Id` → 400 в формате `ErrorResponse`
(`statusCode`, `message: string | string[]`, `error`) — это дефолтный формат
Nest, второй формат для тех же данных никому не нужен.

`GET /health` → 200 либо 503 в формате Terminus
(`status`, `info`, `error`, `details`); проверяются БД и брокер.

`GET /metrics` → 200, Prometheus text format; `contentType` берётся из реестра,
а не хардкодится.

---

## 8. Выход: AMQP

Сервис ничего не публикует наружу, кроме перекладывания отравленных сообщений в
`tournament.parked` с заголовками из 2.3. Тело сохраняется байт в байт: потерять
его хуже, чем запарковать дважды.

---

## 9. Трассировка ТЗ

| Требование ТЗ | Поля | Где |
|---|---|---|
| 1 очко за 1 USD выигрыша | `winAmount` × `fxRate` → `points_awarded` | §2.1 |
| курсы из конфига | `FX_RATES` → `fx_rate` в строке ставки | §3, §5 |
| отмена по `bet.rollback` | `betId` → `status`, `points_awarded` | §2.2 |
| схема события | все 6 полей, без добавленных обязательных | §2.1 |
| топ-100 | `top[]`, `limit` ≤ 100 | §7 |
| позиция из `X-Player-Id` | `me.rank` | §4, §7 |

Полей ТЗ, которые не используются, нет. Полей, которых ТЗ не даёт, а мы
требуем, тоже нет.

---

## 10. Что нашёл аудит

| # | Находка | Чем это кончилось бы | Исправление |
|---|---|---|---|
| 1 | Границы сумм проверялись у множителей, но не у произведения: `winAmount` 1e14 × курс 1.0 = 15 цифр, а `points_awarded` numeric(20,6) держит 14 | переполнение прилетело бы как ошибка драйвера → классификация «инфраструктура» → **бесконечные повторы вместо парковки** | `MAX_POINTS`, проверка произведения в `toPoints`, вход снижен до 1e12, курс ≤ 1e6 |
| 2 | `FX_RATES` со строковым значением не валидировался вообще (`z.union([z.number().positive(), z.string()])`) | `{"EUR":"abc"}` и `{"EUR":"-1"}` проходили бы старт; отрицательный курс → отрицательные очки | единый предикат `isFxRate` + границы |
| 3 | `@IsISO8601` принимает `settledAt` без зоны, а `new Date('…T10:00:00')` читается в **локальной** зоне сервера | одно и то же событие попадает в окно турнира на одном хосте и не попадает на другом | свой `@IsIsoTimestamp`: зона обязательна |
| 4 | `last_scored_at NOT NULL` при первой же проигрышной ставке записывал время, когда игрок ничего не заработал | тай-брейк врал: при равных очках игрок уезжал ниже из-за проигранной ставки | колонка nullable, `NULL` = «не набирал», CHECK `points = 0 OR last_scored_at IS NOT NULL` |
| 5 | Позиция игрока зависела от существования строки, а не от очков | игрок, у которого всё откатили, получал место (напр. 5000-е), а игрок без ставок — `null`, при одинаковом результате | `rank = null ⟺ points = 0`, зафиксировано в контракте |
| 6 | Порты возвращали entity TypeORM (`Bet`, `Tournament`) | ORM протекал в домен и в тесты вместе с ленивой загрузкой и change tracking | `BetRecord`, `TournamentRecord` |
| 7 | `DATABASE_URL`/`RABBITMQ_URL` проверялись только на непустоту | опечатка в схеме URL всплывала бы как таймаут соединения через 10 с, без имени переменной | проверка схемы в zod |
| 8 | `x-death` читался «как-нибудь»: число записей вместо `count` | RabbitMQ группирует хопы по (очередь, причина) и инкрементит `count` — счётчик попыток навсегда остался бы 1, **ретраи стали бы бесконечными** | смоделирован `XDeathEntry`, в контракте описано, что читать |
| 9 | `/metrics` был в плане, но не существовал в коде | нечем доказать, что ретраи и парковки вообще происходят | `MetricsPort`, `MetricsSnapshot`, контроллер, 4 счётчика |
| 10 | Ответы 400 и 503 не были описаны нигде | клиент узнаёт формат ошибки из практики | `ErrorResponse` + аннотации Swagger |
| 11 | Индекс лидерборда и `ORDER BY` расходились по `NULLS LAST` после правки №4 | сортировка перестала бы быть бесплатной | `NULLS LAST` прописан в индексе явно |
| 12 | `DEFAULT_LEADERBOARD_LIMIT` жил в сервисе, а использовался контроллером и DTO | три места знают про «100» по-разному | константы в контракте |

---

## 11. Открытые вопросы

1. **Тип идентификаторов.** ТЗ не говорит, что `betId`/`playerId` — UUID. Сейчас
   валидируем как UUID и храним `uuid`. Если проверяющий пришлёт `bet-1`, всё
   уедет в парковку. Альтернатива — непрозрачная строка 1..64 и колонка `text`.
2. **Ширина кода валюты.** Сейчас строго 3 заглавные буквы и `char(3)`. Для
   гемблинга реальны `USDT`, `USDC`, `MATIC`. Альтернатива — `^[A-Z0-9]{3,10}$`
   и `varchar(10)`.

Оба меняют миграцию и DTO, поэтому вынесены наружу, а не решены молча.
