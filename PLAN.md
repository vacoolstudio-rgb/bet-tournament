# План реализации — «Турнир на ставках»

Документ для аппрува. Всё, что помечено **❓**, — решения, которые я принял сам,
но которые стоит подтвердить или поменять: они меняют код, а не только формулировки.
После аппрува этот файл остаётся в репозитории как история, а спорные места
переезжают в `DECISIONS.md`.

---

## 1. Оценка задачи

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
| Топология RabbitMQ: exchange, queue, retry/DLQ, ack-политика | 3 ч |
| Домен: начисление/откат, идемпотентность, конвертация валют | 3 ч |
| API лидерборда + Swagger | 1.5 ч |
| Продюсер-CLI со сценариями | 1 ч |
| Тесты: unit + интеграционные на testcontainers | 4–5 ч |
| README / AGENTS.md / DECISIONS.md | 2 ч |
| CI (lint + typecheck + tests) | 0.5 ч |
| **Итого** | **≈ 18–20 ч** |

Минимальный «работает и проверяемо» вариант (без интеграционных тестов и retry-очереди) — 5–6 ч.
Предлагаю делать полный: задача именно на то, чтобы показать инженерную аккуратность.

---

## 2. Открытые вопросы ТЗ и мои решения

Это ядро будущего `DECISIONS.md`.

### 2.1 ❓ Что такое «1 очко за каждый 1 USD выигранной ставки»

Формулировка допускает три чтения: `winAmount`, `winAmount − stake` (чистая прибыль),
или `stake` выигравшей ставки.

**Решение: `winAmount`, конвертированный в USD.** Это буквальное чтение «выигранной
суммы», и только оно не уводит очки в минус при `winAmount < stake` (кэшаут с убытком).
Поле `stake` при этом сохраняю в БД — оно нужно для аудита и для возможной смены формулы,
но в очки не входит.

### 2.2 ❓ Дробные очки и округление

Выигрыш 10.40 EUR при курсе 1.08 — это 11.232 USD. Варианты: `floor` на каждом событии
(теряем дробь, десять выигрышей по 0.6 USD дадут 0 очков) или хранить точное значение.

**Решение: храню точные очки `NUMERIC(20,6)`, в API отдаю и точное значение, и
`floor` как целое.** Причина важнее эстетики: при `floor` на каждом событии откат
обязан вычитать ровно начисленное, иначе баланс поедет. Поэтому в любом случае
**фактически начисленные очки пишутся в строку ставки (`points_awarded`) и откат
вычитает именно это сохранённое число, а не пересчитывает формулу заново** — курс в
конфиге может измениться между `settled` и `rollback`.

### 2.3 ❓ Турнирное окно

В схеме события есть `settledAt`, но ТЗ нигде его не использует. Для «турнира» это
естественно читается как «в зачёт идут только ставки, рассчитанные внутри окна турнира».

**Решение: один активный турнир, окно (`starts_at`/`ends_at`) из конфига; события вне
окна подтверждаются (ack) и не начисляют очки, с отдельной метрикой и логом.** Таблица
`tournaments` с `tournament_id` во всех ключах — чтобы схема не переписывалась под
второй турнир. Если считаете это overengineering для ТЗ — скажите, оставлю один
дефолтный турнир с окном «всегда».

### 2.4 Неизвестная валюта

**Решение: это не ретраябл.** Курса в конфиге нет → очки посчитать нельзя, повторные
попытки ничего не изменят до деплоя нового конфига. Такое событие уходит в DLQ с
причиной в заголовках, метрика `unknown_currency`. Молча начислить 0 очков — худший
вариант: потеря денег игрока без следа. `USD = 1` зашит и не берётся из конфига.

### 2.5 Порядок событий

Четыре ситуации, которые обязаны работать:

1. **Дубль `settled`** — очки начисляются один раз (`betId` — PK, `INSERT … ON CONFLICT DO NOTHING`, очки прибавляются только если вставка реально произошла).
2. **`rollback` после `settled`** — вычитаем `points_awarded`, помечаем ставку `rolled_back`.
3. **`rollback` раньше `settled`** — пишем «надгробие»: строку ставки со статусом `rolled_back` и `points_awarded = 0`. Пришедший позже `settled` увидит существующую строку, ничего не начислит.
4. **Дубль `rollback`** — вычитание ровно один раз (переход статуса `settled → rolled_back` делается условным `UPDATE … WHERE status = 'settled'`, по числу затронутых строк решаем, трогать ли очки).

### 2.6 ❓ `X-Player-Id` и отсутствие авторизации

**Решение: заголовок опционален и валидируется как UUID.** Нет заголовка → в ответе
`me: null`, топ-100 отдаётся. Невалидный UUID → 400. В README и DECISIONS отдельно
отмечу, что в проде это поле приходит из JWT/сессии, а не из заголовка, который может
подставить кто угодно.

### 2.7 ❓ Позиция при равных очках

ТЗ не определяет. «Два игрока с 50 очками» — у них одна позиция или разные?

**Решение: строгий детерминированный порядок — `points DESC, last_scored_at ASC,
player_id ASC`.** Кто набрал раньше, тот выше; позиции уникальны, пагинация и
«позиция игрока» согласованы между собой. Dense-rank (общая позиция на равных очках)
даёт расхождение между «номером строки в топе» и «позицией», поэтому не беру.

Игрок без очков (нет в таблице) → `{ points: 0, rank: null }`, а не фиктивное
последнее место: число участников турнира сервис не знает.

### 2.8 Представление денег

ТЗ не говорит, `stake`/`winAmount` — это мажорные единицы (`12.34`) или минорные (`1234`).

**Решение: мажорные единицы, принимаю `string | number`, валидирую как десятичное
неотрицательное с ≤ 4 знаками, внутри считаю `decimal.js`, храню `NUMERIC(20,4)`.**
Float в арифметике денег не появляется нигде. Допущение фиксируется в README и в
JSON-схеме контракта.

---

## 3. Стек

| Решение | Выбор | Почему |
|---|---|---|
| Рантайм | Node 22 LTS, TypeScript 5.x, strict | |
| Фреймворк | NestJS 11 | по ТЗ |
| ❓ RabbitMQ | `@golevelup/nestjs-rabbitmq` | нужен topic-exchange, DLX, ручной ack, prefetch. `@nestjs/microservices` RMQ-транспорт заточен под RPC/один queue и топологию с DLX описывает плохо. Альтернативы: `amqplib` + `amqp-connection-manager` руками (больше кода, полный контроль) |
| ❓ БД-слой | TypeORM 0.3 + явные SQL-миграции, `synchronize: false` | как в payhub, миграции читаемые и ревьюятся. Альтернатива — Prisma (быстрее стартовать, но горячий путь — upsert с инкрементом, который я всё равно пишу сырым SQL) |
| Валидация конфига | zod, падать на старте | |
| Валидация событий | class-validator DTO на входе консьюмера | |
| Деньги | `decimal.js` | |
| Логи | `nestjs-pino`, structured, `betId`/`playerId`/`eventType` в контексте | |
| Метрики / health | `@nestjs/terminus` (`/health`: db + rabbit), `prom-client` (`/metrics`) | |
| ❓ Тесты | vitest + `testcontainers` (postgres + rabbitmq) | как в payhub. Альтернатива — jest + docker-compose в CI |
| Docs API | Swagger на `/api/docs` | |
| CI | GitHub Actions: lint, typecheck, unit, integration | |

Redis/ZSET для лидерборда **не беру**: при одном инстансе и индексе Postgres это
преждевременно. В DECISIONS опишу, на каком объёме и как его вводить.

---

## 4. Структура

```
src/
  main.ts                      bootstrap API + консьюмер в одном процессе
  app.module.ts
  config/                      zod-схема env, курсы валют, окно турнира
  database/
    data-source.ts
    migrations/
    entities/                  Tournament, Bet, PlayerScore
  messaging/
    rabbit.module.ts           топология: exchange, queue, DLX, prefetch
    bet-events.consumer.ts     ack/nack-политика, классификация ошибок
    dto/                       BetSettledEvent, BetRollbackEvent
  scoring/
    scoring.service.ts         начислить / откатить (транзакция)
    fx.service.ts              конвертация по курсам из конфига
    tournament.service.ts      активный турнир, попадание в окно
  leaderboard/
    leaderboard.controller.ts  GET /leaderboard
    leaderboard.service.ts     топ-100 + позиция игрока
  common/                      money, типизированные ошибки, фильтры
tools/
  producer.ts                  CLI-продюсер со сценариями
test/
  unit/
  integration/                 testcontainers: postgres + rabbitmq
docker-compose.yml
README.md  AGENTS.md  DECISIONS.md  PLAN.md
```

---

## 5. Схема БД

```sql
-- турниры: окно, в которое должна попасть ставка по settledAt
tournaments (
  id           uuid        primary key,
  code         text        not null unique,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  created_at   timestamptz not null default now()
)

-- журнал ставок: он же журнал идемпотентности
bets (
  tournament_id  uuid        not null references tournaments(id),
  bet_id         uuid        not null,
  player_id      uuid        not null,
  currency       char(3)     not null,
  stake          numeric(20,4) not null,
  win_amount     numeric(20,4) not null,
  fx_rate        numeric(20,8) not null,   -- курс, по которому считали
  points_awarded numeric(20,6) not null,   -- фактически начисленное (0 для надгробия)
  status         text        not null,     -- 'settled' | 'rolled_back'
  settled_at     timestamptz null,         -- null у надгробия от раннего rollback
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (tournament_id, bet_id)
)
create index on bets (tournament_id, player_id);

-- агрегат для лидерборда
player_scores (
  tournament_id  uuid        not null references tournaments(id),
  player_id      uuid        not null,
  points         numeric(20,6) not null default 0,
  bets_counted   integer     not null default 0,
  last_scored_at timestamptz not null,
  updated_at     timestamptz not null default now(),
  primary key (tournament_id, player_id)
)
-- покрывающий индекс под точный порядок лидерборда
create index on player_scores (tournament_id, points desc, last_scored_at asc, player_id asc);
```

`points` в агрегате никогда не уходит в минус: откат возможен только для ставки,
которая была в статусе `settled`, то есть её очки заведомо в сумме. Инвариант
закрываю `check (points >= 0)` и покрываю тестом.

---

## 6. Топология RabbitMQ

```
            publish bet.settled / bet.rollback
                        │
              ┌─────────▼─────────┐
              │ exchange: bets    │  topic, durable
              └─────────┬─────────┘
                        │ binding: bet.settled, bet.rollback
              ┌─────────▼──────────────────────┐
              │ queue: tournament.bets         │  quorum, durable
              │   x-delivery-limit: 5          │  авто-парковка после 5 доставок
              │   x-dead-letter-exchange: bets.dlx │
              └─────────┬──────────────────────┘
                        │ исчерпан лимит / nack(requeue=false)
              ┌─────────▼─────────┐     ┌──────────────────────┐
              │ exchange bets.dlx │────▶│ queue tournament.dlq │
              └───────────────────┘     └──────────────────────┘
```

Почему quorum-queue с `x-delivery-limit`, а не отдельная retry-очередь с TTL: лимит
доставок и парковка в DLQ получаются брокером из коробки, без ручного цикла
«TTL-очередь → обратно в exchange» и без риска бесконечной петли. Экспоненциальный
backoff так не сделать — если он нужен, добавляю `tournament.bets.retry` с
`x-message-ttl` отдельным шагом (решение в DECISIONS).

**Классификация ошибок — то, ради чего всё это:**

| Ситуация | Действие |
|---|---|
| Невалидная схема события, отрицательные суммы | `nack(requeue=false)` → DLQ сразу. Повтор не поможет |
| Неизвестная валюта | `nack(requeue=false)` → DLQ, метрика |
| `settledAt` вне окна турнира | `ack`, очки не начисляются, метрика. Это не ошибка |
| Дубль / уже откатанная ставка | `ack`. Нормальный путь at-least-once |
| БД недоступна, таймаут, deadlock | `nack(requeue=true)` → переотправка, после 5 попыток DLQ |

Prefetch 20. Конкурентные события одного игрока безопасны: агрегат обновляется
атомарным `INSERT … ON CONFLICT DO UPDATE SET points = player_scores.points + excluded.points`,
без «прочитал → посчитал в коде → записал». Блокировки берутся в одном порядке
(строка `bets`, затем `player_scores`), что исключает взаимную блокировку.

`ack` — только после коммита транзакции. Падение между коммитом и ack даёт
переотправку, которую съедает идемпотентность.

---

## 7. Обработка событий

**`bet.settled`:**

```
BEGIN
  points := winAmount * fx_rate(currency)        -- decimal.js, считается до транзакции
  INSERT INTO bets (…, points_awarded = points, status = 'settled')
    ON CONFLICT (tournament_id, bet_id) DO NOTHING
  если вставки не было → COMMIT, ack (дубль или ставка уже откатана)
  INSERT INTO player_scores (…, points, bets_counted = 1, last_scored_at = settledAt)
    ON CONFLICT (tournament_id, player_id) DO UPDATE
      SET points = player_scores.points + excluded.points,
          bets_counted = player_scores.bets_counted + 1,
          last_scored_at = greatest(player_scores.last_scored_at, excluded.last_scored_at)
COMMIT → ack
```

**`bet.rollback`** (в событии, по ТЗ, тот же `betId`):

```
BEGIN
  UPDATE bets SET status = 'rolled_back', updated_at = now()
    WHERE tournament_id = :t AND bet_id = :b AND status = 'settled'
    RETURNING player_id, points_awarded
  если 0 строк:
     ставки нет вообще → INSERT надгробия (status='rolled_back', points_awarded=0)
     ставка уже rolled_back → ничего
  иначе:
     UPDATE player_scores SET points = points - :points_awarded,
                              bets_counted = bets_counted - 1
       WHERE tournament_id = :t AND player_id = :p
COMMIT → ack
```

Ключевой момент — вычитается `points_awarded` из строки, а не пересчёт по текущему
курсу. Курс в конфиге мог измениться.

---

## 8. API

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

## 9. Продюсер (для проверки)

`npm run produce -- --scenario=<name> [--count=N]`, публикует в exchange `bets`:

| Сценарий | Что проверяет |
|---|---|
| `happy` | обычная пачка settled в разных валютах |
| `duplicate` | один `settled` дважды → очки один раз |
| `rollback` | settled → rollback → очки вернулись к исходным |
| `rollback-first` | rollback раньше settled → очки не начислились |
| `rollback-twice` | двойной rollback → вычет один раз |
| `unknown-currency` | → DLQ, очки не изменились |
| `out-of-window` | `settledAt` вне турнира → ack, 0 очков |
| `malformed` | битая схема → DLQ |
| `load --count=50000` | прогон под нагрузкой, замер времени лидерборда |

---

## 10. Конфиг

```
NODE_ENV, PORT, LOG_LEVEL
DATABASE_URL
RABBITMQ_URL
RABBITMQ_PREFETCH=20
FX_RATES={"EUR":1.08,"GBP":1.27,"UAH":0.024}     # JSON; USD=1 зашит
TOURNAMENT_CODE=nov-2026
TOURNAMENT_STARTS_AT / TOURNAMENT_ENDS_AT        # ISO-8601
```

Валидация zod на старте, падение с понятным сообщением. `.env.example` в репозитории.
`docker compose up` поднимает postgres + rabbitmq (с management UI) + сервис, миграции
применяются на старте контейнера.

---

## 11. Тесты

**Unit** (без инфраструктуры): конвертация валют и точность decimal; неизвестная валюта →
типизированная ошибка; попадание в окно турнира (границы включительно/исключительно);
классификация ошибок консьюмера; формирование ранга и тай-брейков.

**Интеграционные** (testcontainers: postgres + rabbitmq, настоящая публикация в exchange):

1. happy path: 3 события в 3 валютах → ожидаемые очки и порядок в топе;
2. дубль `settled` → очки один раз;
3. `settled` + `rollback` → исходное состояние, `bets_counted` вернулся;
4. `rollback` раньше `settled` → 0 очков, надгробие в БД;
5. двойной `rollback` → один вычет;
6. неизвестная валюта → сообщение в DLQ, очки не изменились;
7. битая схема → DLQ без ретраев;
8. событие вне окна → ack, 0 очков;
9. `GET /leaderboard`: топ отсортирован, `rank` непрерывен, `me` совпадает с позицией в топе;
10. игрок без очков → `me.rank = null, points = 0`;
11. 200 конкурентных событий одного игрока при prefetch 20 → сумма точная (отсутствие гонок).

**Что не покрываю:** падение брокера посередине, чистый перф-бенчмарк — для ТЗ это шум.

---

## 12. Документация

- **README** — что это, быстрый старт (`docker compose up` → продюсер → `curl`), env, контракт событий, схема топологии, API, как гонять тесты.
- **AGENTS.md** — для агентов и для меня-через-месяц: команды, структура, инварианты, которые нельзя ломать (деньги не float; очки списываются из `points_awarded`, а не пересчётом; `synchronize` выключен, схема только миграциями; ack только после коммита; новое событие → новый интеграционный тест), политика тестов и коммитов.
- **DECISIONS.md** — всё из раздела 2 в формате «вопрос → варианты → решение → почему → что бы изменило решение», плюс отвергнутые: Redis ZSET, retry-очередь с backoff, `@nestjs/microservices`, dense-rank, таблица `processed_events` вместо `bets` как журнала идемпотентности.

---

## 13. Порядок коммитов

| # | Коммит | Выход |
|---|---|---|
| 1 | `chore: scaffold` | NestJS 11, strict TS, eslint/prettier, zod-конфиг, docker-compose, `/health` |
| 2 | `feat(db): schema and migrations` | 3 таблицы, индексы, сидирование турнира |
| 3 | `feat(mq): topology and consumer` | exchange/queue/DLX, DTO-валидация, ack-политика, пустой обработчик |
| 4 | `feat(scoring): settle and rollback` | начисление, откат, идемпотентность, конвертация |
| 5 | `feat(api): leaderboard` | `GET /leaderboard`, Swagger |
| 6 | `feat(tools): event producer` | CLI со сценариями |
| 7 | `test: unit and integration` | тесты из раздела 11 |
| 8 | `docs: readme, agents, decisions` | три файла |
| 9 | `ci: github actions` | lint + typecheck + тесты на PR |

Этапы 1–6 показываю на аппрув по готовности, чтобы не уехать не туда на тестах и доках.

---

## 14. Вне объёма (осознанно)

Аутентификация и ACL; несколько одновременных турниров и призовые; исторические курсы
валют (беру текущие из конфига, фиксирую применённый курс в строке ставки); админка;
шардирование и Redis-кеш лидерборда; outbox для исходящих событий — сервис ничего не
публикует; k8s-манифесты.
