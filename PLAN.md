# План реализации — «Турнир на ставках»

Ревизия 2: после ревью плана на конфликты логики и соответствие ТЗ.
Что изменилось относительно первой ревизии — в разделе 15.

---

## 0. Статус решений (аппрув 2026-11-08)

Подтверждено: очки = `winAmount` в USD, дробные хранятся точно (`NUMERIC(20,6)`),
в API — и точное значение, и `floor`; турнирное окно по `settledAt` из конфига;
RabbitMQ через `@golevelup/nestjs-rabbitmq`; TypeORM с явными SQL-миграциями;
тесты на vitest + testcontainers.

---

## 1. Соответствие ТЗ

| Требование ТЗ | Где закрыто |
|---|---|
| Очки по событиям `bet.settled` из очереди | §7 топология, §8 обработчик |
| 1 очко за 1 USD выигранной ставки | §3.1 (`winAmount`), §3.2 (точность и округление) |
| Конвертация валют по курсу из конфига | §3.4, §11 (`FX_RATES`), курс фиксируется в строке ставки |
| Отмена ставки событием `bet.rollback` | §3.5, §3.9, §8 |
| Схема события `{betId, playerId, currency, stake, winAmount, settledAt}` | §8 DTO, §10; принимается как есть, без добавления обязательных полей |
| Продюсер для проверки пишу сам | §10, 9 сценариев |
| Эндпоинт лидерборда: топ-100 | §9 |
| Позиция игрока из заголовка `X-Player-Id` | §9, §3.6 |
| Репозиторий с кодом | этот репозиторий, приватный |
| README | §13 |
| AGENTS.md | §13, по стандарту с agents.md |
| DECISIONS.md: вопросы, решения, обоснования | §13, материал — весь §3 |

Отклонений от ТЗ нет. Добавлено сверх ТЗ: турнирное окно (§3.3), health/metrics,
DLQ с классификацией ошибок, CI. Всё добавленное отмечено в DECISIONS как
осознанное расширение, а не как требование.

---

## 2. Оценка задачи

Задача маленькая по бизнес-логике и целиком про инфраструктурную аккуратность.
Что реально проверяют (и на что я делаю упор):

| Что проверяют | Где это видно в задаче |
|---|---|
| Идемпотентность консьюмера | RabbitMQ = at-least-once, `betId` в схеме — естественный ключ дедупликации |
| Корректность компенсации | `bet.rollback` обязан вычесть ровно то, что начислил `bet.settled` |
| Устойчивость к расстановке событий | `rollback` может прийти раньше `settled`, дважды, или для неизвестной ставки |
| Деньги без float | `stake`/`winAmount` + конвертация по курсу — классическое место, где теряют копейки |
| Транзакционность | начисление очков и отметка ставки обработанной — одна транзакция, ack после коммита |
| Что делать с «плохим» событием | невалидная схема / неизвестная валюта → retry или DLQ, это разные вещи |
| Семантика ранжирования | «позиция игрока» неопределена при равных очках и при игроке вне топа |

Трудозатраты (чистое время, с тестами и документацией):

| Этап | Оценка |
|---|---|
| Каркас: NestJS, конфиг с валидацией, docker-compose, health | 2–3 ч |
| Схема БД + миграции | 1.5 ч |
| Топология RabbitMQ: exchange, queue, retry с TTL, парковка, ack-политика | 4 ч |
| Домен: начисление/откат, идемпотентность, конвертация валют | 3.5 ч |
| API лидерборда + Swagger | 1.5 ч |
| Продюсер-CLI со сценариями | 1 ч |
| Тесты: unit + интеграционные на testcontainers | 5 ч |
| README / AGENTS.md / DECISIONS.md | 2 ч |
| CI (lint + typecheck + tests) | 0.5 ч |
| **Итого** | **≈ 21–22 ч** |

Минимальный «работает и проверяемо» вариант (без интеграционных тестов и retry-очереди) — 5–6 ч.
Предлагаю делать полный: задача именно на то, чтобы показать инженерную аккуратность.

---

## 3. Открытые вопросы ТЗ и мои решения

Это ядро будущего `DECISIONS.md`.

### 3.1 ✅ Что такое «1 очко за каждый 1 USD выигранной ставки»

Формулировка допускает три чтения: `winAmount`, `winAmount − stake` (чистая прибыль),
или `stake` выигравшей ставки.

**Решение: `winAmount`, конвертированный в USD.** Это буквальное чтение «выигранной
суммы», и только оно не уводит очки в минус при `winAmount < stake` (кэшаут с убытком).
Поле `stake` при этом сохраняю в БД — оно нужно для аудита и для возможной смены формулы,
но в очки не входит.

Проигрышная ставка (`winAmount = 0`) — нормальное событие: строка в БД пишется (нужна
для идемпотентности и для последующего `rollback`), очков даёт ноль.

### 3.2 ✅ Дробные очки и округление

Выигрыш 10.40 EUR при курсе 1.08 — это 11.232 USD. Варианты: `floor` на каждом событии
(теряем дробь, десять выигрышей по 0.6 USD дадут 0 очков) или хранить точное значение.

**Решение: храню точные очки `NUMERIC(20,6)`, в API отдаю и точное значение, и
`floor` как целое.** Причина важнее эстетики: при `floor` на каждом событии откат
обязан вычитать ровно начисленное, иначе баланс поедет. Поэтому в любом случае
**фактически начисленные очки пишутся в строку ставки (`points_awarded`) и откат
вычитает именно это сохранённое число, а не пересчитывает формулу заново** — курс в
конфиге может измениться между `settled` и `rollback`.

Следствие для API: сортировка идёт по точным очкам, а клиент видит округлённые.
Два игрока могут показывать одинаковые `points` и стоять на разных местах — это
документируется строкой в README, поле `pointsExact` объясняет порядок.

### 3.3 ✅ Турнирное окно

В схеме события есть `settledAt`, но ТЗ нигде его не использует. Для «турнира» это
естественно читается как «в зачёт идут только ставки, рассчитанные внутри окна турнира».

**Решение: один активный турнир, окно (`starts_at`/`ends_at`) из конфига; события
`bet.settled` вне окна подтверждаются (ack) и не начисляют очки, с отдельной метрикой
и логом.** Границы: `starts_at` включительно, `ends_at` исключительно — закрыто тестом.

**Источник правды — конфиг.** На старте приложение делает upsert строки турнира по
`code`; таблица `tournaments` нужна для ссылочной целостности и для будущего второго
турнира, но не является независимым источником. Смена окна в конфиге **не**
пересчитывает уже начисленные очки — это заявлено в README, а не «так получилось».

**Окно не применяется к `bet.rollback`** — см. 3.9.

### 3.4 ✅ Неизвестная валюта

**Решение: для `bet.settled` это не ретраябл.** Курса в конфиге нет → очки посчитать
нельзя, повторные попытки ничего не изменят до деплоя нового конфига. Такое событие
паркуется с причиной в заголовках, метрика `unknown_currency`. Молча начислить
0 очков — худший вариант: потеря денег игрока без следа. `USD = 1` зашит и не берётся
из конфига.

**К `bet.rollback` правило не применяется** — см. 3.9.

### 3.5 ✅ Порядок событий

Четыре ситуации, которые обязаны работать:

1. **Дубль `settled`** — очки начисляются один раз (`betId` — часть PK, `INSERT … ON CONFLICT DO NOTHING`, очки прибавляются только если вставка реально произошла).
2. **`rollback` после `settled`** — вычитаем `points_awarded`, статус → `rolled_back`.
3. **`rollback` раньше `settled`** — пишем «надгробие»: строка со статусом `rollback_pending` и `points_awarded = 0`. Пришедший позже `settled` дозаполнит в ней аудит (суммы, курс, `settled_at`), переведёт статус в `rolled_back` и **не начислит очков**.
4. **Дубль `rollback`** — вычитание ровно один раз: переход статуса делается условным `UPDATE … WHERE status = 'settled'`, и по числу затронутых строк решается, трогать ли агрегат.

### 3.6 ✅ `X-Player-Id` и отсутствие авторизации

**Решение: заголовок опционален и валидируется как UUID.** Нет заголовка → в ответе
`me: null`, топ-100 отдаётся. Невалидный UUID → 400. В README и DECISIONS отдельно
отмечу, что в проде это поле приходит из JWT/сессии, а не из заголовка, который может
подставить кто угодно.

### 3.7 ✅ Позиция при равных очках

ТЗ не определяет. «Два игрока с 50 очками» — у них одна позиция или разные?

**Решение: строгий детерминированный порядок — `points DESC, last_scored_at ASC,
player_id ASC`.** Кто набрал раньше, тот выше; позиции уникальны, пагинация и
«позиция игрока» согласованы между собой. Dense-rank (общая позиция на равных очках)
даёт расхождение между «номером строки в топе» и «позицией», поэтому не беру.

`last_scored_at` — это «когда игрок последний раз **получил очки**»:

- обновляется только когда `points_awarded > 0`; иначе проигрышная ставка меняла бы позицию игрока, не меняя его очков;
- при откате пересчитывается по оставшимся зачётным ставкам игрока (индексированный `max(settled_at)`), иначе ключ сортировки остался бы от списанной ставки. Если зачётных ставок не осталось, значение сохраняется как есть: очки при этом 0, игрок внизу таблицы, тай-брейк не наблюдаем.

Игрок без очков (нет в таблице) → `{ points: 0, rank: null }`, а не фиктивное
последнее место: число участников турнира сервис не знает.

### 3.8 ✅ Представление денег

ТЗ не говорит, `stake`/`winAmount` — это мажорные единицы (`12.34`) или минорные (`1234`).

**Решение: мажорные единицы, принимаю `string | number`, валидирую как десятичное
неотрицательное, ≤ 4 знаков после точки и ≤ 10^14, внутри считаю `decimal.js`, храню
`NUMERIC(20,4)`.** Верхняя граница и число знаков — часть валидации, а не надежда на
БД: иначе переполнение `numeric(20,4)` вылезет как ошибка драйвера и уйдёт в
повторы вместо парковки. Float в арифметике денег не появляется нигде.
Допущение фиксируется в README и в JSON-схеме контракта.

### 3.9 ✅ `bet.rollback` не трогает ни курсы, ни окно

Найдено на ревью плана: применение к `bet.rollback` тех же правил, что к `bet.settled`,
теряет деньги игроков двумя способами.

- Если фильтровать `rollback` по окну турнира, откат ставки с `settledAt` вне окна будет проигнорирован, а начисленные очки останутся. **Фантомные очки.**
- Если резолвить курс валюты на `rollback`, легитимный откат события в валюте, выпавшей из конфига, уйдёт в парковку — и очки опять останутся.

**Решение: `bet.rollback` адресуется исключительно по `betId`.** Из его полезной
нагрузки обязателен только `betId` (и `playerId` — для логов); `currency`, `stake`,
`winAmount`, `settledAt` принимаются, но в вычислениях не участвуют. Сколько вычесть —
известно из строки ставки, в какой турнир — тоже. Конвертация и проверка окна
выполняются только на пути `bet.settled`.

---

## 4. Стек

| Решение | Выбор | Почему |
|---|---|---|
| Рантайм | Node 26 (как локально, `v26.9.0`), `engines: >=24`, TypeScript 5.x, strict | один и тот же мажор в dev, Docker и CI — иначе расхождение вылезет на нативных модулях |
| Фреймворк | NestJS 12.4 | по ТЗ. 11 в первой ревизии плана — устаревшая версия; payhub уже на 12, `@golevelup/nestjs-rabbitmq@9` в peer-ах держит `^11.1.24 \|\| ^12.0.0` |
| ✅ RabbitMQ | `@golevelup/nestjs-rabbitmq@9.1` | нужен topic-exchange, DLX, ручной ack, prefetch. `@nestjs/microservices` RMQ-транспорт заточен под RPC/одну очередь и топологию с DLX описывает плохо. Альтернатива: `amqplib` + `amqp-connection-manager` руками (больше кода, полный контроль) |
| ✅ БД-слой | TypeORM 1.1 + явные SQL-миграции, `synchronize: false` | как в payhub, миграции читаемые и ревьюятся. Горячий путь (upsert с инкрементом) пишется сырым SQL |
| Валидация конфига | zod 4, падать на старте | |
| Валидация событий | class-validator DTO на входе консьюмера | |
| Деньги | `decimal.js` | |
| Логи | `nestjs-pino`, structured, `betId`/`playerId`/`eventType` в контексте | |
| Метрики / health | `@nestjs/terminus` (`/health`: db + rabbit), `prom-client` (`/metrics`) | |
| ✅ Тесты | vitest + `testcontainers` (postgres + rabbitmq) | как в payhub |
| Docs API | Swagger на `/api/docs` | |
| CI | GitHub Actions: lint, typecheck, unit, integration | |

Redis/ZSET для лидерборда **не беру**: при одном инстансе и индексе Postgres это
преждевременно. В DECISIONS опишу, на каком объёме и как его вводить.

---

## 5. Структура

Контракты вынесены отдельно от реализаций: интерфейс — то, от чего зависит код,
класс — адаптер под него. Сервисы инжектятся по токенам, поэтому юнит-тест
подставляет объект-заглушку, а не поднимает TypeORM.

```
src/
  main.ts                      bootstrap API + консьюмер в одном процессе
  app.module.ts
  config/
    env.schema.ts              zod-схема окружения
    app-config.ts              AppConfig + loadConfig
    config.module.ts           APP_CONFIG
  common/
    money.ts                   Decimal-арифметика, границы сумм
    errors.ts                  PoisonMessageError / RetryableError и причины
    not-implemented.error.ts   маркер незаполненного тела
  database/
    contracts/                 ← порты и I/O
      transaction.ts             TransactionScope, UnitOfWorkPort
      bets.repository.port.ts    SettledBetRow, InsertSettledResult, VoidedBet…
      player-scores.repository.port.ts  CreditPointsInput, DebitPointsInput…
      tournaments.repository.port.ts    TournamentWindow
    entities/                  Tournament, Bet, PlayerScore
    migrations/                явный список, без glob
    repositories/              Postgres-адаптеры портов
    unit-of-work.ts            TypeOrmUnitOfWork
  messaging/
    contracts/                 ← порты и I/O
      bet-events.contract.ts     BetSettledEvent, BetRollbackEvent (wire)
      message-outcome.ts         MessageOutcome, AckReason, FailureOutcome
      ports.ts                   BetEventProcessorPort, OutcomeClassifierPort, ParkingPort
    dto/                       валидаторы, implements wire-контракты
    topology.ts                exchange/queue/аргументы как данные
    bet-event.processor.ts     DTO → команда домена
    bet-events.consumer.ts     AMQP-адаптер: outcome → ack/nack/publish
    outcome.classifier.ts      (error, attempt) → retry | park
    parking.publisher.ts
  scoring/
    scoring.contract.ts        ← SettleBetCommand, RollbackBetCommand, исходы, ScoringPort, FxPort, TournamentPort
    scoring.service.ts  fx.service.ts  tournament.service.ts
  leaderboard/
    leaderboard.contract.ts    ← LeaderboardQuery, LeaderboardEntry, PlayerStanding, LeaderboardView, LeaderboardPort
    dto/                       Swagger-проекции контрактов (implements)
    leaderboard.controller.ts  leaderboard.service.ts
    player-id.decorator.ts     @PlayerId(PlayerIdPipe)
    player-id.pipe.ts
  health/
tools/
  db.ts                        миграции
  producer.ts                  сценарии; строит события по тем же контрактам
test/
  unit/  integration/
docker-compose.yml
README.md  AGENTS.md  CLAUDE.md→AGENTS.md  DECISIONS.md  PLAN.md
```

Правило по типам: **в домен входит разобранное** (`Decimal`, `Date`), **из домена
выходит текст** (точные десятичные строки) — он идёт в логи, метрики и HTTP.
Конвертирует транспортный слой, поэтому ни один сервис не решает заново, что
значит `"12.3400"`.

## 6. Схема БД

```sql
-- турниры: окно, в которое должна попасть ставка по settledAt.
-- Источник правды — конфиг; строка создаётся upsert'ом на старте по code.
tournaments (
  id           uuid        primary key,
  code         text        not null unique,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  created_at   timestamptz not null default now(),
  check (ends_at > starts_at)
)

-- журнал ставок: он же журнал идемпотентности
bets (
  tournament_id  uuid        not null references tournaments(id),
  bet_id         uuid        not null,
  player_id      uuid        not null,
  status         text        not null,       -- 'settled' | 'rolled_back' | 'rollback_pending'
  currency       varchar(10)   null,         -- null только у надгробия
  stake          numeric(20,4) null,
  win_amount     numeric(20,4) null,
  fx_rate        numeric(20,8) null,         -- курс, по которому считали
  points_awarded numeric(20,6) not null default 0,   -- фактически начисленное
  settled_at     timestamptz   null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (tournament_id, bet_id),
  -- надгробие (rollback пришёл первым) не знает сумм; все прочие статусы знают
  check (status <> 'rollback_pending' OR points_awarded = 0),
  check (status =  'rollback_pending' OR (
    currency is not null and stake is not null and win_amount is not null
    and fx_rate is not null and settled_at is not null))
)
-- под пересчёт last_scored_at при откате
create index on bets (tournament_id, player_id, settled_at desc)
  where status = 'settled' and points_awarded > 0;

-- агрегат для лидерборда
player_scores (
  tournament_id  uuid        not null references tournaments(id),
  player_id      uuid        not null,
  points         numeric(20,6) not null default 0,
  bets_counted   integer     not null default 0,
  last_scored_at timestamptz null,           -- null = никогда не набирал очков
  updated_at     timestamptz not null default now(),
  primary key (tournament_id, player_id),
  check (points >= 0),
  check (bets_counted >= 0)
)
-- покрывающий индекс под точный порядок лидерборда
create index on player_scores (tournament_id, points desc, last_scored_at asc, player_id asc);
```

Инварианты `points >= 0` и `bets_counted >= 0` держатся не на вере: вычитание
возможно только при переходе `settled → rolled_back`, то есть ровно один раз и ровно
на ту сумму, которая до этого была прибавлена. CHECK стоит страховкой от будущей
ошибки и покрыт тестом.

---

## 7. Топология RabbitMQ

```
         publish bet.settled / bet.rollback
                        │
              ┌─────────▼──────────┐
              │ exchange: bets     │  topic, durable
              └─────────┬──────────┘
                        │ bindings: bet.settled, bet.rollback
              ┌─────────▼────────────────────────────┐
              │ queue: tournament.bets               │  quorum, durable
              │   prefetch 20                        │
              │   x-dead-letter-exchange: bets.retry │
              │   x-delivery-limit: 20   (страховка) │
              └───┬──────────────────────────────┬───┘
     ретраябл-     │                             │  отравленное сообщение:
     ошибка:       │                             │  публикуем явно + ack
     nack(false)   │                             ▼
              ┌────▼───────────────┐   ┌─────────────────────────┐
              │ exchange bets.retry│   │ queue tournament.parked │
              └────┬───────────────┘   └─────────────────────────┘
              ┌────▼─────────────────────┐        ▲
              │ queue tournament.retry   │        │ x-death count ≥ 5
              │   classic, x-message-ttl │        │ (решает консьюмер)
              │   = 10s                  ├────────┘
              │   DLX → bets (исходный   │
              │   routing key)           │
              └──────────────────────────┘
```

Два разных исхода разведены намеренно, это главный смысл схемы:

- **Ретраябл-ошибка** (БД недоступна, таймаут, deadlock) → `nack(requeue=false)` → сообщение уходит в `bets.retry` → лежит 10 с в retry-очереди → возвращается в `bets` с исходным routing key. Счётчик попыток читается из заголовка `x-death`; на 5-й попытке консьюмер паркует сообщение в `tournament.parked` и подтверждает его.
- **Отравленное сообщение** (битая схема, неизвестная валюта, суммы вне границ) → консьюмер сам публикует его в `tournament.parked` с причиной в заголовках и делает `ack`. Никаких попыток.

Почему не `nack(requeue=true)` плюс `x-delivery-limit: 5`, как было в первой ревизии:
переотправка происходит мгновенно, и двухсекундная недоступность Postgres сожгла бы
все 5 попыток за миллисекунды — события осели бы в DLQ вместо того, чтобы
обработаться через секунду. TTL-очередь даёт паузу между попытками;
`x-delivery-limit: 20` остаётся только страховкой от бесконечной петли при ошибке в
самом консьюмере.

Retry-очередь — classic, а не quorum: `x-message-ttl` у classic-очередей поддержан
без оговорок по версиям брокера. Единая TTL вместо экспоненциального backoff — на
один retry-хоп, сознательный компромисс (в DECISIONS: цепочка TTL-очередей-ступеней
10s/1m/5m, если понадобится).

**Классификация ошибок — то, ради чего всё это:**

| Ситуация | Действие |
|---|---|
| Невалидная схема, отрицательные суммы, > 4 знаков, переполнение | парковка + `ack`. Повтор не поможет |
| Неизвестная валюта в `bet.settled` | парковка + `ack`, метрика `unknown_currency` |
| `settledAt` вне окна турнира (только `bet.settled`) | `ack`, очки не начисляются, метрика. Это не ошибка |
| Дубль / уже откатанная ставка | `ack`. Нормальный путь at-least-once |
| `bet.rollback` для неизвестной ставки | `ack` + надгробие. Не ошибка, а гонка порядка |
| БД недоступна, таймаут, deadlock | retry-хоп, после 5 попыток парковка |
| Неизвестный routing key | парковка + `ack` |

Конкурентные события одного игрока безопасны: агрегат обновляется атомарным
`INSERT … ON CONFLICT DO UPDATE SET points = player_scores.points + excluded.points`,
без «прочитал → посчитал в коде → записал». Блокировки берутся в одном порядке —
сначала строка `bets`, затем `player_scores` — и это соблюдается в обоих
обработчиках, поэтому взаимная блокировка невозможна (конкуренция за строку игрока
остаётся, но это ожидание, а не deadlock).

`ack` — только после коммита транзакции. Падение между коммитом и ack даёт
переотправку, которую съедает идемпотентность.

---

## 8. Обработка событий

**`bet.settled`:**

```
points := winAmount × fx_rate(currency)         -- decimal.js, до транзакции
если settledAt вне окна турнира → ack, метрика, выход
BEGIN
  INSERT INTO bets (…, status='settled', points_awarded=points)
    ON CONFLICT (tournament_id, bet_id) DO UPDATE
      SET currency=…, stake=…, win_amount=…, fx_rate=…, settled_at=…,
          status='rolled_back', updated_at=now()
      WHERE bets.status = 'rollback_pending'          -- дозаполняем надгробие
    RETURNING (xmax = 0) AS inserted
  если не inserted → COMMIT, ack
      (дубль, либо ставка уже откатана — очки не начисляем ни в одном случае)
  INSERT INTO player_scores (…, points, bets_counted=1, last_scored_at=settledAt)
    ON CONFLICT (tournament_id, player_id) DO UPDATE
      SET points        = player_scores.points + excluded.points,
          bets_counted  = player_scores.bets_counted + 1,
          last_scored_at = CASE WHEN excluded.points > 0
                                THEN greatest(player_scores.last_scored_at,
                                              excluded.last_scored_at)
                                ELSE player_scores.last_scored_at END,
          updated_at = now()
COMMIT → ack
```

Проигрышная ставка (`points = 0`) увеличивает `bets_counted`, но не сдвигает
`last_scored_at` — иначе она меняла бы позицию игрока, не меняя его очков.

**`bet.rollback`** (адресуется только по `betId`, без курсов и без проверки окна):

```
BEGIN
  UPDATE bets SET status='rolled_back', updated_at=now()
    WHERE tournament_id=:t AND bet_id=:b AND status='settled'
    RETURNING player_id, points_awarded
  0 строк:
     ставки нет вообще → INSERT надгробия (status='rollback_pending', points_awarded=0)
                         ON CONFLICT DO NOTHING      -- гонка двух rollback'ов
     уже rolled_back / rollback_pending → ничего (дубль)
  иначе, если points_awarded > 0:
     UPDATE player_scores SET
       points        = points - :points_awarded,
       bets_counted  = bets_counted - 1,
       last_scored_at = COALESCE(
         (SELECT max(settled_at) FROM bets
           WHERE tournament_id=:t AND player_id=:p
             AND status='settled' AND points_awarded > 0),
         last_scored_at),
       updated_at = now()
     WHERE tournament_id=:t AND player_id=:p
  иначе (откат проигрышной ставки):
     UPDATE player_scores SET bets_counted = bets_counted - 1 …
COMMIT → ack
```

Два ключевых момента: вычитается `points_awarded` из строки, а не пересчёт по текущему
курсу (курс в конфиге мог измениться), и `last_scored_at` пересчитывается по
оставшимся зачётным ставкам — иначе ключ сортировки остался бы от списанной ставки.
Подзапрос идёт по частичному индексу из §6.

---

## 9. API

```http
GET /leaderboard?limit=100
X-Player-Id: 4f2e… (опционально)
```

```json
{
  "tournament": { "code": "nov-2026", "startsAt": "…", "endsAt": "…", "status": "active" },
  "top": [
    { "rank": 1, "playerId": "…", "points": 1532, "pointsExact": "1532.480000", "betsCounted": 41 }
  ],
  "me": { "rank": 1042, "playerId": "…", "points": 87, "pointsExact": "87.120000", "betsCounted": 6 },
  "generatedAt": "…"
}
```

`limit` по умолчанию и максимум — 100 (ТЗ просит топ-100). `me: null`, если заголовка нет.

Два запроса вместо одного оконного по всей таблице:

1. Топ — `ORDER BY points DESC, last_scored_at ASC, player_id ASC LIMIT :limit`, идёт по индексу.
2. Позиция — `COUNT(*) + 1` по тому же порядку:
   `points > :p OR (points = :p AND (last_scored_at < :t OR (last_scored_at = :t AND player_id < :id)))`.

`ROW_NUMBER() OVER (…)` по всей таблице был бы короче, но это полный проход ради одной
строки. Компромисс и порог, на котором нужен Redis ZSET, — в DECISIONS.

Плюс `GET /health`, `GET /metrics`, Swagger на `/api/docs`.

---

## 10. Продюсер (для проверки)

`npm run produce -- --scenario=<name> [--count=N]`, публикует в exchange `bets`:

| Сценарий | Что проверяет |
|---|---|
| `happy` | обычная пачка settled в разных валютах |
| `duplicate` | один `settled` дважды → очки один раз |
| `rollback` | settled → rollback → очки вернулись к исходным |
| `rollback-first` | rollback раньше settled → очки не начислились |
| `rollback-twice` | двойной rollback → вычет один раз |
| `unknown-currency` | settled с неизвестной валютой → парковка; rollback с неизвестной валютой → **отрабатывает нормально** |
| `out-of-window` | settled вне окна → ack, 0 очков; rollback такой ставки → работает |
| `malformed` | битая схема → парковка |
| `load --count=50000` | прогон под нагрузкой, замер времени лидерборда |

---

## 11. Конфиг

```
NODE_ENV, PORT, LOG_LEVEL
DATABASE_URL
RABBITMQ_URL
RABBITMQ_PREFETCH=20
RABBITMQ_MAX_ATTEMPTS=5
RABBITMQ_RETRY_TTL_MS=10000
FX_RATES={"EUR":1.08,"GBP":1.27,"UAH":0.024}     # JSON; USD=1 зашит
TOURNAMENT_CODE=nov-2026
TOURNAMENT_STARTS_AT / TOURNAMENT_ENDS_AT        # ISO-8601
```

Валидация zod на старте, падение с понятным сообщением. `.env.example` в репозитории.
`docker compose up` поднимает postgres + rabbitmq (с management UI) + сервис, миграции
применяются на старте контейнера.

---

## 12. Тесты

**Unit** (без инфраструктуры), 296 тестов в 19 файлах:

| Файл | Что проверяет |
|---|---|
| `common/money` | границы сумм и курсов, точность decimal, усечение к scale 6, переполнение произведения |
| `common/time` | зона обязательна, календарная строгость (31 ноября — не дата) |
| `common/currency` | 3..10 символов, строгий регистр |
| `config/env.schema` | дефолты, формы, все 25 способов сломать конфиг |
| `messaging/dto-validation` | декораторы DTO: валидные и битые payload'ы по каждому полю |
| `messaging/validate-event` | обёртка: ошибка валидации → poison с причиной |
| `messaging/delivery-attempts` | `x-death`: `count`, а не число записей; битый заголовок → попытка 1 |
| `messaging/outcome-classifier` | retry vs парковка, лимит из конфига, не-Error обёрнут |
| `messaging/bet-event.processor` | нормализация в команду, маршрутизация, узость rollback-команды |
| `messaging/bet-events.consumer` | ack / `Nack(false)` / парковка, «не подтверждать то, что не удалось запарковать» |
| `messaging/parking.publisher` | exchange, тело байт в байт, заголовки причины |
| `messaging/topology` | DLX главной очереди — retry, а не парковка; TTL; delivery-limit |
| `scoring/fx.service` | USD = 1 без конфига, неизвестная валюта → типизированная ошибка |
| `scoring/tournament.service` | границы окна включительно/исключительно, кеш, падение до инициализации |
| `scoring/scoring.service` | 17 тестов: все исходы начисления и отката, одна транзакция, playerId из журнала |
| `leaderboard/leaderboard.service` | ранги, floor vs exact, три состояния `me`, статус турнира |
| `leaderboard/player-id.pipe` | пустой заголовок = отсутствует, битый = 400 |
| `observability/metrics.service` | формат Prometheus, счётчики по причинам, свой реестр |
| `toolchain` | трансформ отдаёт `design:paramtypes` |

Юнит-тесты проверяют **оркестрацию** на подставленных ответах портов, а не
переписывают семантику SQL в фейках: `ON CONFLICT DO NOTHING`, условный
`UPDATE … WHERE status='settled'` и атомарный инкремент — это как раз то, что
достойно проверки, и рукописный фейк доказывал бы лишь, что он согласен сам с
собой. Поэтому «что сервис делает с данным ответом» — здесь, а «Postgres правда
отвечает так» — в интеграционных.

**Интеграционные** (testcontainers: один Postgres и один RabbitMQ на весь прогон,
поднимаются в `globalSetup`), 100 тестов в 5 файлах:

| Файл | Тесты | Что проверяет |
|---|---|---|
| `infrastructure` | 17 | миграция, все 7 CHECK-ов отклоняют то, что должны, индексы созданы частичными и в нужном порядке |
| `topology` | 11 | аргументы очередей через management API; rejected → retry-очередь, а не парковка; возврат в главную очередь после TTL; routing key выживает хоп; `x-death` инкрементит `count`, а не плодит записи |
| `repositories` | 37 | семантика SQL: `ON CONFLICT`, дозаполнение надгробия, условный откат, атомарный инкремент при 25 параллельных кредитах, тай-брейк с NULL, предикат позиции |
| `consumer` | 16 | сквозь брокер: начисление в трёх валютах, дубль, откат, ранний откат, тройной откат, парковка по 4 причинам, окно турнира, смена курса между settled и rollback, имитация недоступности БД (триггер) → retry-хоп → доехало, исчерпание попыток → парковка, два консьюмера на 100 событий |
| `leaderboard.api` | 19 | HTTP: порядок и ранги, тай-брейк, лимиты, три состояния `me`, 400 на битый `limit` и `X-Player-Id`, статусы турнира, `/health`, `/metrics`, Swagger |

Инфраструктурные факты проверяются отдельно от кода, который на них опирается:
`x-death` инкрементит `count` — это утверждение про RabbitMQ, и оно зелёное уже
сейчас, независимо от того, реализован ли счётчик попыток.

**Что не покрываю:** падение брокера посередине, чистый перф-бенчмарк — для ТЗ это шум.

---

## 13. Документация

- **README** — человеку: что это, быстрый старт (`docker compose up` → продюсер → `curl`), env, контракт событий, схема топологии, API, допущения (мажорные единицы, `X-Player-Id` вместо авторизации, окно турнира не пересчитывается задним числом), как гонять тесты.

- **AGENTS.md** — агенту, по стандарту [agents.md](https://agents.md/): обычный markdown в корне репозитория, обязательных полей у формата нет, правило «ближайший к файлу AGENTS.md выигрывает, явная просьба пользователя важнее файла». Репозиторий одномодульный, поэтому один файл в корне, без вложенных. Разделы по их примеру плюс один свой:
  - `## Setup commands` — compose, миграции, продюсер;
  - `## Code style` — strict TS, no float money, никаких `any` в домене;
  - `## Testing instructions` — vitest, testcontainers, нужен докер, как гонять подмножество;
  - `## PR instructions` — формат коммитов, `npm run verify` перед пушем;
  - `## Инварианты, которые нельзя ломать` — деньги не float; откат вычитает `points_awarded`, а не пересчитывает по курсу; `bet.rollback` не резолвит курс и не проверяет окно; `last_scored_at` двигается только при `points_awarded > 0`; `synchronize` выключен, схема только миграциями; ack только после коммита; новый тип события → новый интеграционный тест.

  README остаётся человеческим, AGENTS.md — операционным; дублирования не держу, из README одна ссылка. `CLAUDE.md` — симлинк на `AGENTS.md`, чтобы Claude Code читал тот же файл, а не вторую копию правил.

- **DECISIONS.md** — всё из §3 в формате «вопрос → варианты → решение → почему → что изменило бы решение», плюс отвергнутые варианты: Redis ZSET, экспоненциальный backoff на цепочке TTL-очередей, `nack(requeue=true)` как механизм повторов, in-process retry вместо retry-очереди, `@nestjs/microservices`, dense-rank, таблица `processed_events` вместо `bets` как журнала идемпотентности. И отдельный раздел «что нашло ревью плана» — §15, как честная история проектирования.

---

## 14. Порядок коммитов

| # | Коммит | Выход |
|---|---|---|
| 1 | `chore: scaffold` | NestJS 11, strict TS, eslint/prettier, zod-конфиг, docker-compose, `/health` |
| 2 | `feat(db): schema and migrations` | 3 таблицы, индексы, CHECK-инварианты, upsert турнира на старте |
| 3 | `feat(mq): topology and consumer` | exchange/queue/retry/parking, DTO-валидация, классификация ошибок, пустой обработчик |
| 4 | `feat(scoring): settle and rollback` | начисление, откат, идемпотентность, конвертация, пересчёт `last_scored_at` |
| 5 | `feat(api): leaderboard` | `GET /leaderboard`, Swagger |
| 6 | `feat(tools): event producer` | CLI со сценариями |
| 7 | `test: unit and integration` | тесты из §12 |
| 8 | `docs: readme, agents, decisions` | три файла + симлинк `CLAUDE.md` |
| 9 | `ci: github actions` | lint + typecheck + тесты на PR |

Этапы 1–6 показываю на аппрув по готовности, чтобы не уехать не туда на тестах и доках.

---

## 15. Что нашло ревью плана

Проверял две вещи: нет ли внутренних противоречий и всё ли из ТЗ закрыто. ТЗ закрыто
полностью (§1). Противоречий нашлось восемь, два из них теряли деньги игроков.

| # | Конфликт | Было | Стало |
|---|---|---|---|
| 1 | Окно турнира применялось ко всем событиям | откат ставки с `settledAt` вне окна игнорировался → **фантомные очки навсегда** | окно проверяется только на `bet.settled` (§3.9) |
| 2 | Курс валюты резолвился на любом событии | откат в валюте, выпавшей из конфига, уезжал в DLQ → **очки оставались** | `bet.rollback` адресуется только по `betId` (§3.9) |
| 3 | `last_scored_at` обновлялся на любом `settled` | проигрышная ставка сдвигала позицию игрока, не меняя очков | обновление только при `points_awarded > 0` (§3.7) |
| 4 | `last_scored_at` не пересчитывался при откате | ключ сортировки оставался от списанной ставки | пересчёт по `max(settled_at)` зачётных ставок, частичный индекс (§3.7, §8) |
| 5 | `nack(requeue=true)` + `x-delivery-limit: 5` как механизм повторов | мгновенные переотправки: 2 с недоступности Postgres = события в DLQ | retry-очередь с TTL 10 с, парковка явной публикацией, `x-delivery-limit` — только страховка (§7) |
| 6 | `currency/stake/win_amount/fx_rate` были `NOT NULL` | надгробие от раннего `rollback` этих данных не знает — вставка упала бы | колонки nullable + CHECK по статусу, статус `rollback_pending`, поздний `settled` дозаполняет аудит (§6, §8) |
| 7 | Окно турнира и в конфиге, и в таблице | два источника правды | конфиг — источник, строка создаётся upsert'ом на старте (§3.3) |
| 8 | Тест «200 конкурентных событий при prefetch 20» | одна подписка golevelup обрабатывает последовательно — тест ничего не проверял | два экземпляра приложения на одной очереди (§12, тест 15) |

Дополнительно: валидация сумм получила верхнюю границу и лимит знаков (§3.8) — иначе
переполнение `numeric(20,4)` приходило бы как ошибка драйвера и уходило в повторы
вместо парковки; добавлены CHECK `points >= 0` и `bets_counted >= 0` (§6); добавлена
строка про неизвестный routing key в таблицу классификации (§7); оценка выросла с
18–20 до 21–22 ч.

---

## 16. Вне объёма (осознанно)

Аутентификация и ACL; несколько одновременных турниров и призовые; исторические курсы
валют (беру текущие из конфига, фиксирую применённый курс в строке ставки); админка;
шардирование и Redis-кеш лидерборда; outbox для исходящих событий — сервис ничего не
публикует; k8s-манифесты.

Версии в §4 поправлены по факту проверки реестра npm (8 ноя 2026): NestJS 12.4,
TypeORM 1.1, golevelup 9.1, zod 4, Node 26. В первой ревизии плана стояли Nest 11,
TypeORM 0.3 и Node 22 — сами инструменты те же, устарели только мажоры.
