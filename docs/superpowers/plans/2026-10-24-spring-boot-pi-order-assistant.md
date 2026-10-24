# Spring Boot + Pi Order Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, teaching-oriented Spring Boot + Pi `1.4.0` order query assistant that demonstrates lightweight DDD, Java-to-Pi LF JSONL RPC, a single long-lived `PiWorker`, three read-only order Tools, task lifecycle APIs, reset isolation, and Real Pi + Fake Provider evidence.

**Architecture:** Keep the existing repository root as the Pi study workbench and place one independent Maven Module under `spring-boot-order-assistant/`. Inside that module, use the approved modular-monolith boundaries: `web`, `order`, `agent`, `pi.runtime`, `security`, and `infrastructure`. `order.application` coordinates the use case, `agent.application` depends only on domain-neutral Agent ports, `infrastructure.pi` adapts those ports to `pi.runtime`, and the TypeScript Extension calls only the loopback Bridge. The first implementation slice must reach Java → Pi → Extension → Bridge → Tool Result before adding lifecycle hardening.

**Tech Stack:** JDK 21, Spring Boot `4.1.1`, Maven `3.9.16` via Maven Wrapper, Node.js `24.20.0`, npm `11.19.0`, Pi `1.4.0`, TypeScript `5.9.3`, TypeBox `1.3.27`, undici `8.10.2`, ArchUnit `1.4.2`, JUnit 5, Spring MVC Test, and a loopback-only Fake OpenAI-compatible SSE Provider.

**Source design:** [Spring Boot + Pi 订单查询助手技术方案](../../plans/spring-boot-pi-order-assistant-design.md) defines the stable architecture and evidence contracts; this file expands them into executable tasks and commands.

---

## Working rules and fixed paths

- The Maven Module root is `spring-boot-order-assistant/`; this keeps the existing Node workbench root independent while still delivering one Maven Module.
- All paths in the tasks below are relative to the repository root unless they begin with `src/`, in which case they are relative to `spring-boot-order-assistant/` as shown.
- The active Pi baseline is exactly `1.4.0`. Do not use `latest` or a floating Pi dependency.
- Default tests use Fake Pi or Real Pi + Fake Provider. Do not call a real Provider during implementation or default verification.
- Never read, print, hash, or commit real credentials. Fixtures use synthetic keys such as `dummy-key`.
- Public request bodies are limited to 8 KiB, internal Bridge requests to 1 KiB, public responses to 16 KiB, internal responses and final Extension Tool Results to 2 KiB.
- All public and internal business endpoints are POST. Actuator Health keeps Spring Boot’s default GET behavior.
- `OrderRepository` is `order.domain.port.OrderRepository`; its first adapter is `infrastructure.order.InMemoryOrderRepository`.
- `AgentRunTracker` is `agent.port.AgentRunTracker`; `order.application.OrderRunTracker` implements it. `agent.application` must not import `order`.
- `PiWorker` is a single-writer component. Mutable Worker state is changed only by its coordinator executor.
- A task is accepted only after `prompt` returns `success=true` and `disposition="started"`.
- A task is `COMPLETED` only when the approved `OrderRunTracker` contract and `agent_settled(aborted=false)` both pass.
- After each task, inspect the diff and stage only named files if a local checkpoint commit is explicitly requested. Never use `git add -A`, push, or create a Pull Request.

## File map before implementation

Create the following structure progressively. Do not create empty placeholder packages merely to make the tree look complete.

```text
spring-boot-order-assistant/
├── pom.xml
├── mvnw
├── mvnw.cmd
├── .mvn/wrapper/maven-wrapper.properties
├── .node-version
├── .npmrc
├── scripts/check-toolchain.sh
├── README.md
├── pi-extension/
│   ├── package.json
│   ├── package-lock.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts
│   │   ├── bridge-client.ts
│   │   └── tools/order-tools.ts
│   └── test/
│       ├── bridge-client.test.ts
│       ├── order-tools.test.ts
│       └── pi-contract-probe.test.ts
├── src/main/java/com/xiexu/pistudy/
│   ├── OrderAssistantApplication.java
│   ├── web/
│   │   ├── OrderAssistantController.java
│   │   ├── InternalAgentToolController.java
│   │   ├── ApiRequest.java
│   │   ├── ApiResponse.java
│   │   └── WebExceptionHandler.java
│   ├── order/
│   │   ├── domain/model/
│   │   ├── domain/service/OrderAccessService.java
│   │   ├── domain/port/OrderRepository.java
│   │   └── application/
│   ├── agent/
│   │   ├── application/AgentRunCoordinator.java
│   │   ├── model/
│   │   └── port/
│   ├── pi/runtime/
│   ├── security/
│   └── infrastructure/
│       ├── order/InMemoryOrderRepository.java
│       └── pi/ProcessPiWorker.java
├── src/main/resources/application.yml
├── src/test/java/com/xiexu/pistudy/
│   ├── architecture/ArchitectureRulesTest.java
│   ├── order/
│   ├── agent/
│   ├── pi/runtime/
│   ├── web/
│   └── infrastructure/pi/
└── src/test/resources/
    ├── fake-pi/
    ├── fake-provider/
    └── fixtures/
```

The implementation must keep one responsibility per focused class. If a class grows to own transport, task storage, and domain rules simultaneously, split it before continuing to the next slice.

### Task 0: Bootstrap the independent Maven and Extension module

**Files:**

- Create: `spring-boot-order-assistant/pom.xml`
- Create: `spring-boot-order-assistant/mvnw`
- Create: `spring-boot-order-assistant/mvnw.cmd`
- Create: `spring-boot-order-assistant/.mvn/wrapper/maven-wrapper.properties`
- Create: `spring-boot-order-assistant/.node-version`
- Create: `spring-boot-order-assistant/.npmrc`
- Create: `spring-boot-order-assistant/scripts/check-toolchain.sh`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/OrderAssistantApplication.java`
- Create: `spring-boot-order-assistant/src/main/resources/application.yml`
- Create: `spring-boot-order-assistant/pi-extension/package.json`
- Create: `spring-boot-order-assistant/pi-extension/package-lock.json`
- Create: `spring-boot-order-assistant/pi-extension/tsconfig.json`
- Create: `spring-boot-order-assistant/pi-extension/src/index.ts`
- Test: `spring-boot-order-assistant/src/test/java/com/xiexu/pistudy/BootstrapContextTest.java`
- Test: `spring-boot-order-assistant/src/test/java/com/xiexu/pistudy/architecture/ArchitectureRulesTest.java`
- Test: `spring-boot-order-assistant/pi-extension/test/order-tools.test.ts`

- [ ] **Step 1: Write the bootstrap tests and create the minimum runnable test shell.**

  Make `BootstrapContextTest` load `OrderAssistantApplication` and assert that the application starts with the default profile. Make the initial Extension test assert that the exported factory can be imported and that the readiness command name is `order-assistant-ready`.

  Before running those tests, use the already-installed Maven only to generate the Wrapper (`mvn -N wrapper:wrapper -Dmaven=3.9.16`), create a minimal `pom.xml` with the Spring Boot test dependencies, create `scripts/check-toolchain.sh`, and create the Extension manifest, lockfile, TypeScript config, and test script. The shell must be runnable, but it must intentionally omit `OrderAssistantApplication.java` and `pi-extension/src/index.ts` so the next step produces a meaningful Red result. The initial `ArchitectureRulesTest` skeleton may import the base package and assert that the application class is in the approved root package; it becomes runnable after Step 3 adds that class.

- [ ] **Step 2: Run the bootstrap tests to establish the expected missing-source failure.**

  Run:

  ```bash
  cd spring-boot-order-assistant
  export DEMO_NODE_BIN="/absolute/path/to/node"
  export DEMO_NPM_CLI="/absolute/path/to/npm"
  ./scripts/check-toolchain.sh
  ./mvnw -Dtest='BootstrapContextTest,ArchitectureRulesTest' test
  "$DEMO_NODE_BIN" "$DEMO_NPM_CLI" ci --ignore-scripts --omit=optional --audit=false --fund=false --prefix pi-extension
  "$DEMO_NODE_BIN" "$DEMO_NPM_CLI" --prefix pi-extension exec tsc -- --noEmit
  ```

  Expected: the toolchain script reports Node `v24.20.0` and npm `11.19.0`; Maven reaches compilation and reports that `OrderAssistantApplication` is missing; TypeScript reports that the configured source entry is missing. A missing `./mvnw`, missing package manifest, or unvalidated ambient Node/npm executable is not an acceptable Red result.

- [ ] **Step 3: Complete the Maven and Node bootstrap.**

  Add `OrderAssistantApplication.java` and the initial Extension `index.ts`. Implement `scripts/check-toolchain.sh` to require absolute executable `DEMO_NODE_BIN` and `DEMO_NPM_CLI`, report their versions, and fail unless Node is `v24.20.0` and npm is `11.19.0`. Configure the Spring Boot parent/BOM at `4.1.1`, Java release 21, Maven Enforcer for the Java major version, JUnit 5, Spring MVC Test, ArchUnit test scope, and Failsafe. Configure one `offline-e2e` profile with `failIfNoTests=true` and Failsafe includes for all four Real Pi integration classes: `PiV140BaseContractProbeIT`, `PiV140ToolContractProbeIT`, `RealPiFakeProviderIT`, and `RealPiCancelTimeoutIT`. Individual tests are selected with `-Dit.test=...`; the profile must not claim to contain only one of them.

  Configure `pi-extension/package.json` with exact Pi `1.4.0` development dependencies, TypeScript `5.9.3`, TypeBox `1.3.27`, and undici `8.10.2`; keep the package’s runtime peer relationship aligned with the host Pi. The initial `index.ts` may expose only the readiness command and a placeholder Tool registry that throws a fixed configuration error until Task 5.

- [ ] **Step 4: Run the bootstrap tests and version checks.**

  Run:

  ```bash
  cd spring-boot-order-assistant
  export DEMO_NODE_BIN="/absolute/path/to/node"
  export DEMO_NPM_CLI="/absolute/path/to/npm"
  ./scripts/check-toolchain.sh
  ./mvnw -version
  ./mvnw -Dtest='BootstrapContextTest,ArchitectureRulesTest' test
  "$DEMO_NODE_BIN" "$DEMO_NPM_CLI" ci --ignore-scripts --omit=optional --audit=false --fund=false --prefix pi-extension
  "$DEMO_NODE_BIN" "$DEMO_NPM_CLI" --prefix pi-extension test -- --runInBand
  "$DEMO_NODE_BIN" "$DEMO_NPM_CLI" --prefix pi-extension run check
  "$DEMO_NODE_BIN" -p "require('./pi-extension/node_modules/@earendil-works/pi-coding-agent/package.json').version"
  ```

  Expected: the toolchain check reports Node `v24.20.0` and npm `11.19.0`; Maven context and the initial Extension/architecture tests pass; the version command prints `1.4.0`; the lockfile has all direct dependencies at the planned exact versions.

### Stage gate map

Use this table when updating the implementation checklist. A stage is complete only after its listed command produces the stated direct evidence.

| Design stage | Plan tasks | Required command/evidence | Entry condition for next stage |
|---|---|---|---|
| 0 | Task 0 | Wrapper/version checks, context test, Extension check, exact dependency baseline, architecture skeleton | Reproducible module and exact dependency baseline |
| 1 | Tasks 1-2 | `OrderAccessServiceTest`, projection tests, repository tests, `HttpEnvelopeTest`, and `Utf8BodyLimitFilterTest` | Tenant/owner isolation, three Java projection contracts, request envelope, and body limits pass |
| 2 | Tasks 3-4 | Unit runtime tests plus `./mvnw -Poffline-e2e -Dit.test=PiV140BaseContractProbeIT -DfailIfNoTests=true verify` | Real Pi `1.4.0` starts with the fixed AgentDefinition, readiness and base RPC contract probe pass, covers cancellation/timeout and shuts down |
| 3 | Task 5 | `./mvnw -Poffline-e2e -Dit.test=PiV140ToolContractProbeIT -DfailIfNoTests=true verify` followed by `./mvnw -Poffline-e2e -Dit.test=RealPiFakeProviderIT -DfailIfNoTests=true verify` | Java → Pi → Extension → Bridge → Tool Result → settled is directly observed, and fixed Tool contract is measured |
| 4 | Task 6 | Extension check, Tracker/Bridge matrix, three Tool schema and reservation tests | Three fixed Tools, authorization, ordering, limits, and result rules pass |
| 5 | Task 7 | `OrderAssistantApiIntegrationTest` and TaskStore tests | 202/429/404/503/status/terminal TTL behavior is fixed |
| 6 | Task 8 | Worker lifecycle tests plus `-Dit.test=RealPiCancelTimeoutIT` | Cancel, timeout, heartbeat, shutdown, and real Pi abort evidence pass |
| 7 | Task 8 | Reset and cross-task tests included in lifecycle suite | Trusted reset isolates generations and old context cannot enter a new task |
| 8 | Tasks 9-10 | `./mvnw test`, `"$DEMO_NODE_BIN" "$DEMO_NPM_CLI" --prefix pi-extension run check`, and full `offline-e2e clean verify` | Three ordered same-PID tasks, docs, and default offline gates pass |
| 9 | Task 11 | Fresh explicit authorization followed by one bounded Smoke | Optional real Provider evidence is reported separately and never becomes the default gate |

The table is an execution gate, not a claim that any stage is complete before its command has actually run.

**Files:**

- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/order/domain/model/OrderId.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/order/domain/model/TenantId.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/order/domain/model/RunId.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/order/domain/model/OrderStatus.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/order/domain/model/Order.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/order/domain/model/OrderStatusProjection.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/order/domain/model/OrderPaymentProjection.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/order/domain/model/OrderLogisticsProjection.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/order/domain/port/OrderRepository.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/order/domain/service/OrderAccessService.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/security/DemoPrincipal.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/security/DemoIdentityService.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/infrastructure/order/InMemoryOrderRepository.java`
- Test: `spring-boot-order-assistant/src/test/java/com/xiexu/pistudy/order/domain/OrderValueObjectTest.java`
- Test: `spring-boot-order-assistant/src/test/java/com/xiexu/pistudy/order/domain/OrderAccessServiceTest.java`
- Test: `spring-boot-order-assistant/src/test/java/com/xiexu/pistudy/order/infrastructure/InMemoryOrderRepositoryTest.java`

- [ ] **Step 1: Write failing value-object and access-rule tests.**

  Cover canonical numeric `orderId` values from 1 to 20 digits, rejection of whitespace/control characters and invalid order IDs, stable tenant and run IDs, fixed users `alice` and `bob`, same-tenant owner access, cross-tenant rejection, and the exact three projection allowlists:

  - status: `orderId`, `status`, `statusText`, `updatedAt`, `nextAction`;
  - payment: `orderId`, `status`, `paidAt`, `channel`, `failureCode`;
  - logistics: `orderId`, `status`, `carrier`, `latestEvent`, `estimatedDeliveryAt`.

  Assert that no projection contains amount, card number, address, phone, recipient, or unrelated fields.

- [ ] **Step 2: Run the focused domain tests.**

  Run `cd spring-boot-order-assistant && ./mvnw -Dtest='*OrderValueObjectTest,*OrderAccessServiceTest' test`.

  Expected: compilation fails because the value objects and services do not exist yet.

- [ ] **Step 3: Implement the smallest immutable domain model.**

  Use records/value objects with constructor validation. Keep `Order` read-only for this Demo. Put tenant, owner, and support rules in `OrderAccessService`; expose three explicit methods returning the three immutable projection records rather than a generic Map or a broad DTO. Do not put Spring annotations or HTTP concerns in `order.domain`. Make `OrderRepository` return immutable snapshots and make `InMemoryOrderRepository` own only synthetic fixture data.

- [ ] **Step 4: Run the focused domain tests again.**

  Run the same Maven command. Expected: all value-object, identity, access, whitelist, and repository tests pass.

- [ ] **Step 5: Add the direct evidence note.**

  Record in the plan/ledger checkpoint that the order domain is verified only against synthetic fixtures and that no database or real order system exists.

### Task 2: Implement the domain-neutral HTTP envelope and security limits

**Files:**

- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/web/ApiRequest.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/web/ApiResponse.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/web/RequestIdValidator.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/web/Utf8BodyLimitFilter.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/web/WebExceptionHandler.java`
- Modify: `spring-boot-order-assistant/src/main/resources/application.yml`
- Test: `spring-boot-order-assistant/src/test/java/com/xiexu/pistudy/web/HttpEnvelopeTest.java`
- Test: `spring-boot-order-assistant/src/test/java/com/xiexu/pistudy/web/Utf8BodyLimitFilterTest.java`

- [ ] **Step 1: Write failing envelope and boundary tests.**

  Use MockMvc and direct filter tests to cover canonical UUIDv4 request IDs, non-object JSON, unknown properties, null data, incorrect Content-Type, chunked/streamed body limits, safe fixed error messages, and response requestId echoing.

- [ ] **Step 2: Run the focused tests and confirm Red.**

  Run `cd spring-boot-order-assistant && ./mvnw -Dtest='*HttpEnvelopeTest,*Utf8BodyLimitFilterTest' test`.

  Expected: the envelope types, filter, and exception handler are missing.

- [ ] **Step 3: Implement the generic envelope and bounded reader.**

  Configure Jackson to reject unknown properties. Validate the request ID with a canonical lowercase UUIDv4 check rather than only `UUID.fromString`. Enforce the byte limit while reading the body, not only from `Content-Length`. Map failures to the fixed codes in the design, with no exception body or order data in the response.

- [ ] **Step 4: Run the focused tests and a context test.**

  Run:

  ```bash
  cd spring-boot-order-assistant
  ./mvnw -Dtest='*HttpEnvelopeTest,*Utf8BodyLimitFilterTest,BootstrapContextTest' test
  ```

  Expected: all envelope and limit tests pass.

### Task 3: Build the Pi runtime transport and fixed-version contract probe

**Files:**

- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/pi/runtime/LfJsonlDecoder.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/pi/runtime/RpcRecord.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/pi/runtime/RpcCommandResponse.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/pi/runtime/PiEvent.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/pi/runtime/PiRpcClient.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/pi/runtime/PiProcessManager.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/agent/model/AgentDefinition.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/pi/runtime/PiReadiness.java`
- Modify: `spring-boot-order-assistant/pi-extension/src/index.ts`
- Create: `spring-boot-order-assistant/pi-extension/src/tools/order-tools.ts`
- Modify: `spring-boot-order-assistant/pi-extension/test/order-tools.test.ts`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/pi/runtime/PiRpcContractProbe.java`
- Create: `spring-boot-order-assistant/src/test/java/com/xiexu/pistudy/pi/runtime/LfJsonlDecoderTest.java`
- Create: `spring-boot-order-assistant/src/test/java/com/xiexu/pistudy/pi/runtime/PiRpcClientTest.java`
- Create: `spring-boot-order-assistant/src/test/java/com/xiexu/pistudy/pi/runtime/FakePiRpcMain.java`
- Create: `spring-boot-order-assistant/src/test/java/com/xiexu/pistudy/pi/runtime/FakePiRpcContractProbeTest.java`
- Create: `spring-boot-order-assistant/src/test/java/com/xiexu/pistudy/infrastructure/pi/PiV140BaseContractProbeIT.java`
- Create: `spring-boot-order-assistant/src/test/resources/fixtures/pi-rpc-contract-fixture.json`
- Create: `spring-boot-order-assistant/src/test/resources/fake-provider/readiness-models.json`
- Create: `spring-boot-order-assistant/src/test/resources/fake-provider/readiness.sse`

- [ ] **Step 1: Write the decoder tests.**

  Cover LF records, CRLF rejection or explicit handling according to the design, split UTF-8 code points across reads, U+2028/U+2029, invalid UTF-8, oversized records, EOF with an incomplete record, and malformed JSON.

- [ ] **Step 2: Run `LfJsonlDecoderTest` and verify the expected Red result.**

  Run `cd spring-boot-order-assistant && ./mvnw -Dtest=LfJsonlDecoderTest test`.

  Expected: the decoder class is missing.

- [ ] **Step 3: Implement strict LF JSONL decoding.**

  Decode bytes incrementally with a bounded buffer, reject malformed UTF-8 and oversized records, require one complete JSON record per LF boundary, and surface fixed transport classifications rather than raw parser text.

- [ ] **Step 4: Write and run the RPC client and Fake Pi contract tests.**

  Add tests for command serialization, request/response correlation, event delivery, stdout EOF, stderr draining, writer failure, reader failure, command timeout, and shutdown. `FakePiRpcContractProbeTest` is a Fake Pi test only; it must never start a real Pi process. Run `./mvnw -Dtest='PiRpcClientTest,FakePiRpcContractProbeTest' test`; expected initial failures identify missing client behavior.

- [ ] **Step 5: Implement the client and process manager.**

  Use `ProcessBuilder` with an explicit executable, controlled working directory, explicit environment allowlist, separate stdout/stderr handling, and a single writer. Keep `pi.runtime` free of order, web, security, and Agent concrete types.

- [ ] **Step 6: Add the fixed Pi `1.4.0` AgentDefinition and contract probes.**

  Implement `AgentDefinition` with the fixed id `order-assistant`, controlled provider/model, canonical Extension entrypoint, exact Tool set, stable command arguments, and path validation. Implement `PiReadiness` to require the expected `get_state`, `get_commands`, and `get_available_models` responses plus the `order-assistant-ready` Extension command before the Worker becomes UP.

  `FakePiRpcContractProbeTest` records synthetic transport shapes only. `PiV140BaseContractProbeIT` starts the installed Pi `1.4.0` with a controlled temporary `HOME`, `TMPDIR`, and `PI_CODING_AGENT_DIR`, the fixed AgentDefinition, the full fixed order Extension with its three Tool definitions, `--offline`, and a loopback Fake Provider. It must prove startup/readiness, the base command/event field shapes and ordering, at least one cancellation or timeout sequence, and bounded shutdown. It must send no Prompt that invokes an order Tool and must not claim Tool execution, Tool Result, schema, `structuredContent`, `details`, `isError`, or `executionMode` evidence. The test must generate only fixed structural evidence in `src/test/resources/fixtures/pi-rpc-contract-fixture.json`; never store credentials or raw Provider responses.

  The Base Probe records only the actual shapes and ordering for `prompt` dispositions, `clear_queue`, `abort`, `new_session`, `get_state`, `get_commands`, `get_available_models`, `agent_start`, `agent_end`, `agent_settled`, the custom readiness command, and process shutdown. Tool execution, Tool Result, schema, `--no-extensions`/explicit Extension Tool loading, `executionMode="sequential"`, and Tool output fields are recorded only by `PiV140ToolContractProbeIT` in Task 5.

- [ ] **Step 7: Run the runtime and real readiness gates.**

  Run:

  ```bash
  cd spring-boot-order-assistant
  ./mvnw -Dtest='LfJsonlDecoderTest,PiRpcClientTest,FakePiRpcContractProbeTest' test
  ./mvnw -Poffline-e2e -Dit.test=PiV140BaseContractProbeIT -DfailIfNoTests=true verify
  ```

  Expected: decoder/client/Fake Pi tests pass, then `PiV140BaseContractProbeIT` reports Pi `1.4.0`, the fixed AgentDefinition, successful readiness, actual base RPC/Extension evidence, a cancellation or timeout sequence, and clean shutdown. This is the direct Stage 2 gate; ordinary `./mvnw test` must not start Real Pi.

### Task 4: Define Agent Run ports, Worker state, and the first tracker

**Files:**

- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/agent/model/AgentRunStatus.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/agent/model/AgentRun.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/agent/model/AgentRunResult.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/agent/port/AgentRunRequest.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/agent/port/AgentRunTracker.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/agent/port/PiWorker.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/agent/application/AgentRunCoordinator.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/infrastructure/pi/ProcessPiWorker.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/order/application/OrderRunTracker.java`
- Test: `spring-boot-order-assistant/src/test/java/com/xiexu/pistudy/agent/PiWorkerTest.java`
- Test: `spring-boot-order-assistant/src/test/java/com/xiexu/pistudy/agent/AgentRunCoordinatorTest.java`
- Test: `spring-boot-order-assistant/src/test/java/com/xiexu/pistudy/order/OrderRunTrackerTest.java`
- Modify: `spring-boot-order-assistant/src/test/java/com/xiexu/pistudy/architecture/ArchitectureRulesTest.java`

- [ ] **Step 1: Write failing Worker and Tracker tests.**

  Extend the Task 0 `ArchitectureRulesTest` skeleton with the full package rules while writing the failing Worker and Tracker tests. Use a fake `PiWorker` port and protocol records to cover one active Run, `started` acceptance, queued/handled/rejected dispositions, generation filtering, Tool call uniqueness, known Tool names, run/order binding, final Assistant ordering, `agent_settled`, zero/duplicate/failed/unknown Tools, and terminal result mapping.

- [ ] **Step 2: Run the focused tests and architecture test.**

  Run `cd spring-boot-order-assistant && ./mvnw -Dtest='*PiWorkerTest,*AgentRunCoordinatorTest,*OrderRunTrackerTest,ArchitectureRulesTest' test`.

  Expected: the Agent ports, Worker, Tracker, and architecture rules are missing or fail against the empty implementation.

- [ ] **Step 3: Implement domain-neutral Agent records and ports.**

  Keep `AgentRunRequest` typed with `AgentRunTracker`, not `OrderRunTracker`. The request may carry only `taskId`, `runId`, `actorId`, `resourceId`, prompt, and tracker. `PiWorker` must not import `Order`, `DemoPrincipal`, Controller, or order error codes.

- [ ] **Step 4: Implement the single-writer Worker and Coordinator.**

  Route submit, event, cancel, timeout, heartbeat, reset, and shutdown messages through one coordinator executor. Use `System.nanoTime()` for deadlines. Publish immutable snapshots. Reject a second active submit with the fixed busy error. Keep process generation and session generation checks in the Worker.

- [ ] **Step 5: Implement `OrderRunTracker` through the generic interface.**

  Make it validate the fixed three Tool names, one call per Tool, matching IDs and order/run values, successful Tool end plus matching Tool Result, final Assistant ordering and size, `stopReason=stop`, and `agent_settled(aborted=false)`. It must return a domain-neutral `AgentRunResult` and fixed error code.

- [ ] **Step 6: Run the tests and verify package direction.**

  Run the same focused Maven command. Expected: Worker, Coordinator, Tracker, and ArchUnit tests pass; `agent.application` has no dependency on `order` or `web`.

### Task 5: Implement the `query_order` Extension and first real vertical slice

**Files:**

- Modify: `spring-boot-order-assistant/pi-extension/src/index.ts`
- Create: `spring-boot-order-assistant/pi-extension/src/bridge-client.ts`
- Modify: `spring-boot-order-assistant/pi-extension/src/tools/order-tools.ts`
- Create: `spring-boot-order-assistant/pi-extension/test/bridge-client.test.ts`
- Modify: `spring-boot-order-assistant/pi-extension/test/order-tools.test.ts`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/order/application/OrderAssistantService.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/web/InternalAgentToolController.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/infrastructure/pi/PiWorkerConfiguration.java`
- Create: `spring-boot-order-assistant/src/test/java/com/xiexu/pistudy/web/InternalBusinessToolIntegrationTest.java`
- Create: `spring-boot-order-assistant/src/test/java/com/xiexu/pistudy/infrastructure/pi/PiV140ToolContractProbeIT.java`
- Create: `spring-boot-order-assistant/src/test/java/com/xiexu/pistudy/infrastructure/pi/RealPiFakeProviderIT.java`
- Create: `spring-boot-order-assistant/src/test/resources/fake-provider/models.json`
- Create: `spring-boot-order-assistant/src/test/resources/fake-provider/query-order.sse`
- Create: `spring-boot-order-assistant/src/test/resources/fake-provider/tool-contract.sse`

- [ ] **Step 1: Write failing TypeScript Tool and Bridge tests.**

  Verify the `query_order` TypeBox parameters and output schema, fixed path `/internal/v1/agent-tools/query-order`, process Token header, runId/orderId forwarding, AbortSignal timeout, 3xx rejection, body-size limit, safe error conversion, and `executionMode="sequential"`.

- [ ] **Step 2: Run the Extension tests and confirm Red.**

  Run `cd spring-boot-order-assistant && "$DEMO_NODE_BIN" "$DEMO_NPM_CLI" --prefix pi-extension test -- --runInBand`.

  Expected: the Bridge client and Tool registration are incomplete.

- [ ] **Step 3: Implement the Bridge client and `query_order` Tool.**

  Read only Java-injected loopback URL and process Token from the controlled Extension configuration. Use the three definitions and schemas created in Task 3. Replace only the `query_order` fixed-error executor with the Bridge-backed implementation; keep `query_payment` and `query_logistics` as explicit fixed-error placeholders until Task 6. Never accept a caller-supplied tenant, principal, capability, or arbitrary URL. Convert successful Bridge data into the Pi `content`, `structuredContent`, and `details` shape while enforcing the 2 KiB final Tool Result limit.

- [ ] **Step 4: Implement the minimal internal Bridge endpoint.**

  Add a POST endpoint at `/internal/v1/agent-tools/query-order` using `ApiRequest<T>`. Validate the Token, active run reservation, runId/orderId match, current Demo principal, and `OrderAccessService` projection. Return only the fixed query-order whitelist.

- [ ] **Step 5: Run the Java and Extension vertical tests.**

  Run:

  ```bash
  cd spring-boot-order-assistant
  "$DEMO_NODE_BIN" "$DEMO_NPM_CLI" --prefix pi-extension run check
  ./mvnw -Dtest=InternalBusinessToolIntegrationTest test
  ```

  Expected: the Bridge contract and query-order permission tests pass without a real Provider.

- [ ] **Step 6: Run the real Pi Tool Contract Probe.**

  Run `./mvnw -Poffline-e2e -Dit.test=PiV140ToolContractProbeIT -DfailIfNoTests=true verify`.

  Expected: after the existing full fixed Extension has a Bridge-backed `query_order` executor and the other two fixed definitions expose only their fixed configuration error, the fixed Pi `1.4.0` probe records explicit Extension loading, the three active Tool definitions, `executionMode="sequential"`, and a single Assistant Message containing `query_order` plus a second placeholder Tool Call. It must assert that the second Tool execution starts only after the first Tool’s execution end and Tool Result event. It also records the successful `query_order` Tool execution start/end, Assistant ToolCall, Tool Result, `outputSchema`, `structuredContent`, `details`, and `isError` shapes. This is the direct Stage 3 fixed-version Tool contract evidence and is separate from the Fake Pi transport test.

- [ ] **Step 7: Run the first Real Pi + Fake Provider integration test.**

  Run `./mvnw -Poffline-e2e -Dit.test=RealPiFakeProviderIT -DfailIfNoTests=true verify`.

  Expected: one synthetic alice task completes through Java → Pi `1.4.0` → Extension → Bridge → `query_order` → Tool Result → final Assistant → `agent_settled`. The test must assert that the Fake Provider received a request and that no non-loopback endpoint was used.

### Task 6: Add the remaining Tools, reservation ordering, and business-result matrix

**Files:**

- Modify: `spring-boot-order-assistant/pi-extension/src/tools/order-tools.ts`
- Modify: `spring-boot-order-assistant/pi-extension/src/index.ts`
- Modify: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/web/InternalAgentToolController.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/order/application/ToolReservation.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/order/application/OrderToolBridgeService.java`
- Modify: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/order/application/OrderRunTracker.java`
- Test: `spring-boot-order-assistant/pi-extension/test/order-tools.test.ts`
- Test: `spring-boot-order-assistant/src/test/java/com/xiexu/pistudy/order/OrderRunTrackerTest.java`
- Test: `spring-boot-order-assistant/src/test/java/com/xiexu/pistudy/web/InternalBusinessToolIntegrationTest.java`

- [ ] **Step 1: Add failing tests for payment, logistics, and reservation races.**

  Cover the exact schemas and fixed paths for `query_payment` and `query_logistics`, each Tool’s whitelist, duplicate Tool rejection, unknown Tool rejection, cancellation-before-reservation, reservation-before-cancellation, 750 ms reservation deadline, 3-second Bridge deadline, and 30-second Agent deadline.

- [ ] **Step 2: Run focused tests and confirm only the new cases fail.**

  Run the TypeScript and Java test commands from Tasks 4-5. Expected: existing query-order tests stay Green; new Tools and race cases are Red.

- [ ] **Step 3: Implement the two Tools and the run-scoped reservation.**

  Register exactly `query_order`, `query_payment`, and `query_logistics`; set sequential execution; reject arbitrary Tool names or URLs. Let the Worker/Tracker own authorization decisions while the Bridge service performs only the authorized in-memory read. Map each endpoint to its matching `OrderAccessService` method and Java projection record: `readStatus -> OrderStatusProjection`, `readPayment -> OrderPaymentProjection`, and `readLogistics -> OrderLogisticsProjection`. The Bridge must not serialize a generic `Order`, `Map`, or broad DTO, and tests must assert that sensitive amount/card/address/phone/recipient fields cannot appear in any Tool response.

- [ ] **Step 4: Run the Tool, Bridge, and Tracker matrix.**

  Run:

  ```bash
  cd spring-boot-order-assistant
  "$DEMO_NODE_BIN" "$DEMO_NPM_CLI" --prefix pi-extension run check
  ./mvnw -Dtest='*OrderRunTrackerTest,InternalBusinessToolIntegrationTest' test
  ```

  Expected: all three Tool schemas, reservation order, permission, size, timeout, and failure-mapping tests pass.

### Task 7: Add submit/status/cancel API and in-memory task snapshots

**Files:**

- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/order/application/OrderTaskStore.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/order/application/InMemoryOrderTaskStore.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/order/application/OrderAssistantDtos.java`
- Modify: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/order/application/OrderAssistantService.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/web/OrderAssistantController.java`
- Modify: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/web/WebExceptionHandler.java`
- Create: `spring-boot-order-assistant/src/test/java/com/xiexu/pistudy/web/OrderAssistantApiIntegrationTest.java`
- Create: `spring-boot-order-assistant/src/test/java/com/xiexu/pistudy/order/OrderTaskStoreTest.java`

- [ ] **Step 1: Write failing MockMvc and TaskStore tests.**

  Cover submit acceptance only after `started`, queued/handled/rejected mapping, 202/503 responses, one active task and 429 busy, status snapshots, status ownership/404 anti-enumeration, 10-minute TTL, 32-terminal capacity, injected-clock expiry, cancel idempotency, and no partial answer on failure.

- [ ] **Step 2: Run the focused API tests and verify Red.**

  Run `cd spring-boot-order-assistant && ./mvnw -Dtest='OrderAssistantApiIntegrationTest,OrderTaskStoreTest' test`.

  Expected: controller, DTOs, and TaskStore behavior are absent or incomplete.

- [ ] **Step 3: Implement immutable TaskStore snapshots and DTO validation.**

  Use an injected `Clock` for TTL tests. Keep task and run IDs distinct from request IDs. Store fixed statuses and error codes only; never store or return partial answer text for a failed task.

- [ ] **Step 4: Implement the three public POST endpoints.**

  Add exactly:

  - `POST /api/v1/order-assistant/queries/submit`
  - `POST /api/v1/order-assistant/queries/status`
  - `POST /api/v1/order-assistant/queries/cancel`

  Keep public controllers dependent on `OrderAssistantService`, not on `PiRpcClient` or `ProcessBuilder`. Map unknown/non-owner/expired tasks to the same `TASK_NOT_FOUND` response.

- [ ] **Step 5: Run the API tests and the full Java unit suite.**

  Run `cd spring-boot-order-assistant && ./mvnw test`.

  Expected: domain, runtime, Worker, Bridge, TaskStore, and MockMvc tests pass.

### Task 8: Complete cancellation, timeout, heartbeat, reset, and shutdown lifecycle

**Files:**

- Modify: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/agent/application/AgentRunCoordinator.java`
- Modify: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/infrastructure/pi/ProcessPiWorker.java`
- Modify: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/pi/runtime/PiRpcClient.java`
- Modify: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/pi/runtime/PiProcessManager.java`
- Create: `spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/pi/runtime/PiHealthSnapshot.java`
- Modify: `spring-boot-order-assistant/src/main/resources/application.yml`
- Create: `spring-boot-order-assistant/src/test/java/com/xiexu/pistudy/agent/PiApplicationLifecycleTest.java`
- Modify: `spring-boot-order-assistant/src/test/java/com/xiexu/pistudy/agent/PiWorkerTest.java`
- Modify: `spring-boot-order-assistant/src/test/java/com/xiexu/pistudy/pi/runtime/FakePiRpcMain.java`
- Create: `spring-boot-order-assistant/src/test/java/com/xiexu/pistudy/infrastructure/pi/RealPiCancelTimeoutIT.java`

- [ ] **Step 1: Write failing lifecycle tests.**

  Cover cancel from RUNNING and CANCELLING, exactly one `clear_queue` and `abort`, user cancellation versus business timeout, `agent_settled.aborted`, Tool cancellation, heartbeat failure, reset failure, process exit/EOF, shutdown budget, callback cleanup, and no non-daemon thread or child process residue.

- [ ] **Step 2: Run the Worker and lifecycle tests to establish Red.**

  Run `cd spring-boot-order-assistant && ./mvnw -Dtest='*PiWorkerTest,*PiApplicationLifecycleTest' test`.

  Expected: the new cancel, timeout, heartbeat, reset, and shutdown cases fail.

- [ ] **Step 3: Implement ordered cancellation and deadline handling.**

  Move the task to `CANCELLING`, reject new reservations, send `clear_queue` then `abort` once, await the corresponding settled/exit evidence, and map deadline causes to fixed error codes. Never infer user cancellation from `aborted=true` alone.

- [ ] **Step 4: Implement heartbeat, reset, and DOWN transitions.**

  Reset trusted sessions with `new_session`, verify clean state and readiness, and enter `DOWN` when transport/process/reset trust is lost. During reset, submit must return 429; after successful readiness it may accept a new task.

- [ ] **Step 5: Implement Spring lifecycle shutdown.**

  Use a bounded `SmartLifecycle`/destroy path that stops acceptance, drains or cancels the active Run, closes the Bridge client, terminates the Pi process, joins reader/writer/coordinator threads, and records only safe fixed classifications.

- [ ] **Step 6: Run the lifecycle suite and the Real Pi cancellation gate.**

  Run:

  ```bash
  cd spring-boot-order-assistant
  ./mvnw -Dtest='*PiWorkerTest,*PiApplicationLifecycleTest' test
  ./mvnw -Poffline-e2e -Dit.test=RealPiCancelTimeoutIT -DfailIfNoTests=true verify
  ```

  Expected: Fake Pi covers protocol and race cases; Real Pi `1.4.0` + Fake Provider covers at least one real cancel/timeout path and verifies `clear_queue`, `abort`, `agent_settled`, process state, and post-failure Worker state.

### Task 9: Add Architecture Rules and deterministic three-task E2E

**Files:**

- Complete: `spring-boot-order-assistant/src/test/java/com/xiexu/pistudy/architecture/ArchitectureRulesTest.java`
- Create: `spring-boot-order-assistant/src/test/java/com/xiexu/pistudy/infrastructure/pi/RealPiFakeProviderIT.java` if not completed in Task 5
- Create: `spring-boot-order-assistant/src/test/resources/fake-provider/models.json`
- Create: `spring-boot-order-assistant/src/test/resources/fake-provider/three-task.sse`
- Create: `spring-boot-order-assistant/src/test/resources/fixtures/order-fixtures.json`
- Modify: `spring-boot-order-assistant/pom.xml`
- Modify: `spring-boot-order-assistant/src/main/resources/application.yml`

- [ ] **Step 1: Write the complete architecture assertions.**

  Assert `pi.runtime` does not depend on `agent`, `order`, `web`, or `security`; `agent.application` does not depend on `order` or `web`; `order.domain` does not depend on `web`, `pi.runtime`, or security implementation; `web` does not depend on `PiRpcClient` or `PiProcessManager`; and infrastructure adapters depend only on their declared ports/runtime.

- [ ] **Step 2: Run the architecture test and fix only actual dependency violations.**

  Run `cd spring-boot-order-assistant && ./mvnw -Dtest=ArchitectureRulesTest test`.

  Expected: the rules pass without adding a generic platform layer or reflection-based escape hatch.

- [ ] **Step 3: Implement the deterministic Fake Provider.**

  Bind it only to a random loopback port. Fix the model ID, API type, SSE event order, Tool Call fixtures, delay/hold behavior, and synthetic API key in test resources. Create isolated temporary `HOME`, `TMPDIR`, and `PI_CODING_AGENT_DIR`; clear real credential, proxy, cloud identity, and `NODE_OPTIONS` variables before starting Pi.

- [ ] **Step 4: Write the three sequential task E2E.**

  Use one Pi PID for: alice `query_order`, alice all three Tools, then reset and bob all three Tools. Assert prompt `started`, Tool Call/Result IDs, run/order binding, final Assistant, `agent_settled(aborted=false)`, clean `get_state`, no previous-task canary in the next Provider request, and no child-process residue.

- [ ] **Step 5: Add the final offline profile gate.**

  Configure the `offline-e2e` profile so it includes `PiV140BaseContractProbeIT`, `PiV140ToolContractProbeIT`, `RealPiFakeProviderIT`, and `RealPiCancelTimeoutIT`, and `clean verify` fails when no matching E2E test is discovered. Keep ordinary `./mvnw test` free of Real Pi and Provider network calls. Use `-Dit.test=<ClassName>` for focused base-contract, Tool-contract, success, or cancellation runs; omit it for the complete offline gate.

- [ ] **Step 6: Run the full default and offline gates.**

  Run:

  ```bash
  cd spring-boot-order-assistant
  ./mvnw test
  "$DEMO_NODE_BIN" "$DEMO_NPM_CLI" --prefix pi-extension run check
  ./mvnw -Poffline-e2e -DskipITs=false -DfailIfNoTests=true clean verify
  ```

  Expected: Java tests, Extension checks, and the four Real Pi `1.4.0` + Fake Provider integration classes in the `offline-e2e` profile all pass; the Fake Provider observed real model requests, and no real Provider or credential file was used.

### Task 10: Finish README, teaching notes, evidence, and ledger update

**Files:**

- Create: `spring-boot-order-assistant/README.md`
- Create: `docs/learning/10-spring-boot-pi-order-assistant.md`
- Modify: `docs/learning/README.md`
- Modify: `docs/plans/pi-complete-learning-plan.md`
- Modify: `docs/plans/spring-boot-pi-order-assistant-design.md` only if implementation evidence changes a design assumption

- [ ] **Step 1: Write the README and teaching notes from verified behavior.**

  Explain the package graph, one active Run rule, request/task/run IDs, Prompt Response versus Event versus `agent_settled`, Tool Bridge reservation, process Token, reset isolation, Fake Provider boundary, and exact default commands. Label every result as tested evidence, design decision, or known limitation.

- [ ] **Step 2: Add links and verify all local paths.**

  Link the new learning note from `docs/learning/README.md`. Check that module files, plan links, and design links exist. Do not rewrite historical Pi version records.

- [ ] **Step 3: Update the unique learning ledger without marking 8.8 complete.**

  Add the implementation-plan path and the actual verified slice/status under 8.8. Keep the checkbox unchecked until the final direct evidence and learner acceptance are complete. Record that real Provider Smoke remains separately authorized and that the default gate used synthetic data.

- [ ] **Step 4: Run documentation and sensitive-information checks.**

  Run from the repository root:

  ```bash
  git diff --check
  rg -n -i 'api[_-]?key|oauth|bearer|secret|token|password|private[_-]?key' spring-boot-order-assistant docs/learning/10-spring-boot-pi-order-assistant.md
  ```

  Expected: only intentional fixed names such as `Process Token`, synthetic `dummy-key`, and documentation descriptions appear; no real credential material is present. Review every match manually.

### Task 11: Final acceptance and optional real Provider Smoke boundary

**Files:**

- Modify only the exact files whose final evidence or documentation changed.
- Do not modify credential files, user AgentDirs, or global Pi configuration.

- [ ] **Step 1: Run the complete default verification one final time.**

  Run the Maven unit/integration suite, `"$DEMO_NODE_BIN" "$DEMO_NPM_CLI" --prefix pi-extension run check`, the Architecture test, and `offline-e2e clean verify`. Save only safe summaries and fixed counts; do not store raw Prompt, Tool Result, Answer, stderr, or Provider payloads.

- [ ] **Step 2: Inspect the full working-tree scope.**

  Run `git status --short --untracked-files=all`, `git diff --check`, `git diff --stat`, and a staged-file sensitive scan before any checkpoint commit. Confirm that `.idea/`, `node_modules/`, temporary AgentDirs, and credentials are not tracked.

- [ ] **Step 3: Update the ledger with direct evidence.**

  Only after all required default gates pass, record the exact commands and results. Do not mark the project complete from the presence of files or a plan.

- [ ] **Step 4: Treat real Provider Smoke as a separate user-authorized action.**

  If requested later, require a fresh explicit authorization naming the Provider, Model, dedicated AgentDir, network access, and possible cost. Use `RUN_REAL_PROVIDER_SMOKE=CONFIRMED` and the dedicated settings from the design; execute one bounded request without retries, then report only safe fixed outcomes. A historical authorization or environment variable is not sufficient.

## Verification and checkpoint cadence

At the end of every task:

```bash
cd spring-boot-order-assistant
./mvnw test
"$DEMO_NODE_BIN" "$DEMO_NPM_CLI" --prefix pi-extension run check
cd ..
git diff --check
git status --short --untracked-files=all
```

Use the narrower task command first; run the full suite after a task changes shared contracts or lifecycle behavior. If a test fails or behavior is unexpected, apply the systematic-debugging skill before changing implementation code. Do not broaden the test matrix without a new failure, new change, or unresolved risk.

If a local checkpoint commit is explicitly requested, first inspect the complete diff and sensitive scan, then stage only the named files for that task, for example:

```bash
git add spring-boot-order-assistant/pom.xml \
  spring-boot-order-assistant/src/main/java/com/xiexu/pistudy/order \
  spring-boot-order-assistant/src/test/java/com/xiexu/pistudy/order

git diff --cached --check
git commit -m "feat(order): add order domain slice"
```

Never stage with `git add -A`; never push or create a Pull Request as part of this plan.

## Completion criteria

The implementation plan is complete only when the following evidence exists:

- the Maven Wrapper and Extension lockfile resolve the fixed versions;
- domain, runtime, Worker, Tracker, Bridge, API, lifecycle, and Architecture tests pass;
- Real Pi `1.4.0` + Fake Provider proves one real vertical task, one real cancellation/timeout path, and three ordered tasks on one PID with reset isolation;
- no default command reads real credentials or calls a non-loopback Provider;
- README and teaching notes explain evidence boundaries and known limitations;
- the learning ledger records direct evidence and keeps 8.8 unchecked until learner acceptance;
- any optional real Provider Smoke is separately authorized and reported apart from default acceptance.
