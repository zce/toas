---
status: accepted
---

# Provider and processing kernel architecture

The product has one primary voice-processing operation. Refine is an optional enhancement of that operation, not an independent product. Product Config describes that user-facing model; the Kernel resolves it into an ephemeral Plan containing one or two physical Steps.

This design keeps each Provider cohesive, makes cross-provider Refine a first-class operation, permits explicit integrated Refine, and keeps provider protocols independent from the GNOME Host.

## Architecture

```text
+----------------------------- Host ------------------------------+
|                                                                |
| Recording       Preferences       Config Store                 |
| Secret Store    Context           Output / History             |
| Environment                                                    |
|                                                                |
| Runtime                                                        |
|   |-- HttpTransport                                            |
|   `-- Clock                                                    |
+------------------------------+---------------------------------+
                               |
              audio + Config + Context + Runtime
                               |
                               v
+----------------------------- Kernel ----------------------------+
|                                                                |
| Providers                                                      |
|   |-- Qwen                                                     |
|   |-- MiMo                                                     |
|   |-- OpenAI                                                   |
|   `-- ...                                                      |
|                                                                |
| Config                                                         |
|   |-- primary Provider + values                                |
|   |-- Context                                                  |
|   `-- optional Refine                                          |
|        |-- integrated                                          |
|        `-- separate Provider + values                          |
|                                                                |
|                  buildExecutionPlan()                          |
|                            |                                   |
|                            v                                   |
| Plan                                                           |
|   |-- Step 1: audio -> text                                    |
|   `-- Step 2: text -> text (optional)                          |
|                                                                |
|                            |                                   |
|                            v                                   |
|                     Result + Trace                             |
+----------------------------------------------------------------+
```

Config and Plan are deliberately different:

```text
Persisted Config
      |
      | resolve and validate
      v
Ephemeral Plan
      |
      | execute
      v
Result + Trace
```

Config is persisted and user-facing. Plan is runtime-only and records physical execution. Physical Steps never appear in persisted settings.

## Principles

> The product has one primary voice-processing operation.

> Refine is an optional enhancement of that operation, not an independent product.

> Product configuration is not the physical execution plan.

> Execution may consist of one or two Steps.

> Provider represents one cohesive service integration.

> One Provider may support primary processing, Refine, or both.

> Primary processing and separate Refine may use different Providers.

> Cross-provider composition is a first-class requirement.

> Integrated Refine is an explicit user configuration, never an implicit optimization.

> A configured separate Refine Provider must never be silently skipped.

> Provider-level configuration is shared; primary and Refine model configuration is independent.

> Provider owns protocol; Host owns HTTP execution.

> Context is supplied by the Host and may be empty.

> The settings UI reflects the simplicity of the product rather than exposing internal execution abstractions.

> Keep the Kernel small. Add abstractions only when demonstrated requirements exist.

## Vocabulary

The Kernel favours short, single-word terms.

| Term | Meaning |
| --- | --- |
| **Host** | The runtime-specific product shell, initially the GNOME Shell extension. |
| **Kernel** | Runtime-agnostic configuration resolution and processing orchestration. |
| **Provider** | One cohesive service or protocol integration. |
| **Manifest** | Declarative Provider fields, role support, and capabilities. |
| **Processor** | One configured physical executor with a single `process()` method. |
| **Config** | Persisted product configuration for primary processing and optional Refine. |
| **Plan** | Ephemeral physical execution derived from Config. |
| **Step** | One Processor call in a Plan. |
| **Context** | Optional Host-supplied reference material. |
| **Instructions** | Opaque directions configured for Refine. |
| **Result** | Final text, Trace, and an optional warning. |
| **Trace** | A safe record of the physical Steps that actually ran. |

`Integration`, `Adapter`, `Offering`, `Connection`, `Kind`, `Backend`, and `Engine` are not Kernel entities. A Provider is the cohesive integration unit. A Processor is the runtime adapter role, but the code calls it a Processor.

`processing` and `refine` may be used as internal Provider roles. They are not an extra user-facing hierarchy.

## Product model

```text
Voice processing
|
|-- Primary Provider
|-- Primary values
|
`-- Refine (optional)
     |-- enabled
     |-- execution: separate | integrated
     |-- Provider + values (separate only)
     |-- Instructions
     `-- onError: fallback | abort (separate only)

Host attempt inputs (not Config):
  Context snapshot (user Context text), secrets, environment
```

The Primary Provider answers: who first processes this Recording?

The Refine Provider answers: when separate Refine is enabled, who performs the second text-processing call?

They are intentionally asymmetric. There is no independent Refine workflow without primary voice processing.

## Config

Config represents the product model, not physical Steps. It has no `transcription` wrapper and no `steps` array.

Provider-level non-secret values are stored once in `providers`, keyed by Provider id. Role-specific values remain at the role that uses them.

### Separate Refine

```javascript
const config = {
  providers: {
    qwen: {
      endpoint: 'https://dashscope.aliyuncs.com/...'
    },
    mimo: {
      endpoint: 'https://token-plan-cn.xiaomimimo.com/v1'
    }
  },

  provider: 'qwen',

  values: {
    model: 'qwen3-asr-flash',
    language: 'auto'
  },


  refine: {
    enabled: true,
    execution: 'separate',
    provider: 'mimo',
    values: {
      model: 'mimo-text-model'
    },
    instructions: 'Refine the text without changing its meaning.',
    onError: 'fallback'
  }
}
```

### Integrated Refine

```javascript
const config = {
  providers: {
    qwen: {
      endpoint: 'https://dashscope.aliyuncs.com/...'
    }
  },

  provider: 'qwen',

  values: {
    model: 'instruction-aware-audio-model',
    language: 'auto'
  },


  refine: {
    enabled: true,
    execution: 'integrated',
    instructions: 'Refine the text without changing its meaning.'
  }
}
```

Integrated Refine has no Refine Provider, Refine model, or `onError`: there is only one primary Processor call, so its failure fails the whole attempt.

### Refine disabled

```javascript
const config = {
  providers: {
    mimo: {
      endpoint: 'https://token-plan-cn.xiaomimimo.com/v1'
    }
  },
  provider: 'mimo',
  values: {
    model: 'mimo-v2.5-asr',
    language: 'auto'
  },
  refine: {
    enabled: false
  }
}
```

There is one Provider-level configuration per Provider id. Multiple accounts and per-Step credentials are not supported.

For example, MiMo used for both roles is represented as:

```javascript
const config = {
  providers: {
    mimo: {
      endpoint: 'https://token-plan-cn.xiaomimimo.com/v1'
    }
  },
  provider: 'mimo',
  values: {
    model: 'mimo-v2.5-asr'
  },
  refine: {
    enabled: true,
    execution: 'separate',
    provider: 'mimo',
    values: {
      model: 'mimo-text-model'
    },
    instructions: '...',
    onError: 'fallback'
  }
}
```

The endpoint is stored once. The MiMo credential is also stored once outside Config.

## Manifest

Each Provider exports one declarative Manifest. It separates genuinely shared Provider fields from primary-processing fields and Refine fields.

```javascript
const manifest = {
  label: 'MiMo',

  fields: [
    {
      key: 'endpoint',
      type: 'url',
      label: 'Endpoint',
      required: true,
      default: 'https://token-plan-cn.xiaomimimo.com/v1',
      env: ['TOAS_MIMO_ENDPOINT']
    },
    {
      key: 'key',
      type: 'secret',
      label: 'API key',
      required: true,
      env: ['MIMO_API_KEY']
    }
  ],

  primary: {
    fields: [
      {
        key: 'model',
        type: 'string',
        label: 'Model',
        required: true
      },
      {
        key: 'language',
        type: 'string',
        label: 'Language',
        default: 'auto'
      }
    ],
    capabilities: {
      integratedRefine: false
    }
  },

  refine: {
    fields: [
      {
        key: 'model',
        type: 'string',
        label: 'Model',
        required: true
      }
    ],
    capabilities: {
      context: true
    }
  }
}
```

The Manifest is data, not GTK code. The initial generic field types are `string`, `text`, `url`, `secret`, `boolean`, `number`, and `choice`.

The Manifest declares role support:

- `processing` is required for a selectable Primary Provider;
- `refine` is required for a selectable separate Refine Provider;
- one Provider may declare either role or both;
- `processing.capabilities.integratedRefine` explicitly states whether primary processing can satisfy configured Refine in the same audio-to-text call.

Accepting Instructions is not sufficient evidence for integrated Refine. The effective `integratedRefine` Capability must be `true`.

When capabilities vary by primary model, `Provider.resolve()` returns the effective capabilities from an explicit provider-owned mapping. Unknown model names never gain capabilities through guessing, and capabilities are never discovered remotely.

## Provider

One Provider owns one service or protocol integration, including shared validation, authentication mapping, request construction, response parsing, error mapping, and Processor creation.

```javascript
const provider = {
  id: 'mimo',
  manifest,

  resolve ({
    role,
    providerValues,
    values,
    secretPresence
  }) {
    return {
      config,
      capabilities,
      issues
    }
  },

  create (role, config, secrets, runtime) {
    return processor
  }
}
```

`role` is either `processing` or `refine`. It is an internal contract, not a user-facing Kind.

`resolve()` is pure and performs no I/O. It owns:

- defaults;
- normalization;
- shared and role-specific validation;
- cross-field validation;
- secret-presence validation;
- effective Capability resolution.

`create()` performs no I/O. It creates a Processor bound to the resolved Provider and role configuration. The same Provider object creates both MiMo Processors in a MiMo-to-MiMo Plan, using the same Provider values and secrets but independent role values.

A Provider does not own orchestration, Refine strategy, Context acquisition, HTTP execution, persistence, UI, or history.

## Processor

Processor is the only physical processing interface:

```javascript
const output = await processor.process({
  input,
  context,
  instructions,
  signal
})
```

Input is audio or text:

```javascript
const audio = {
  kind: 'audio',
  bytes,
  mimeType: 'audio/wav',
  durationMs: 21740
}

const text = {
  kind: 'text',
  text: '...'
}
```

Processor returns only normalized, safe data:

```javascript
const output = {
  text: '...',
  model: '...',
  finishReason: null,
  usage: null,
  requestId: null,
  responseId: null
}
```

Provider-specific response objects and arbitrary metadata do not cross this interface.

Processor does not expose task-specific methods such as `transcribe()`, `refine()`, or `translate()`. It does not know the whole workflow. A primary Processor does not know whether another Step follows; a Refine Processor does not know which Provider produced its input.

## HTTP

Provider owns HTTP protocol details. Host owns HTTP execution.

The Kernel defines only the concrete HTTP seam required now:

```javascript
class HttpTransport {
  async send (request, signal) {}
}

const request = {
  method: 'POST',
  url: 'https://...',
  headers: {},
  body: bytes
}

const response = {
  status: 200,
  headers: {},
  body: bytes
}
```

The GNOME Host supplies `SoupHttpTransport`. A future CLI can supply `FetchHttpTransport` without changing Provider, Processor, Config resolution, or Plan construction.

```text
Processor
   |
   | Provider builds HttpRequest
   v
HttpTransport
   |
   | Host executes I/O
   v
Service
   |
   | Host returns HttpResponse
   v
Provider parses response
```

Provider owns:

- URL and HTTP method;
- headers and authentication representation;
- body construction;
- response parsing;
- provider-specific interpretation of HTTP errors.

Host `HttpTransport` owns:

- actual I/O;
- cancellation;
- timeout;
- transport failure classification.

DNS, TLS, proxying, and redirect handling are delegated to the runtime's HTTP stack (Soup defaults). A hard response-size cut-off is deferred: the current path reads whole responses through Soup's whole-response API, and an incremental-reading limit is not justified by present risk.

Providers never import Soup, `fetch`, or Gio networking. Host code never constructs or parses Qwen, MiMo, or OpenAI payloads. No generic Transport, WebSocket abstraction, or gRPC abstraction is introduced.

## Resolution

The Kernel resolves Config in a small, explicit sequence:

```text
1. Resolve Host-stored and environment values from the Manifests.
2. Resolve primary Provider with role = processing.
3. If Refine is disabled, build one primary Step.
4. If Refine is separate, resolve its Provider with role = refine.
5. If Refine is integrated, validate primary integratedRefine = true.
6. Create the required Processors.
7. Build an ephemeral Plan.
```

Invalid Config produces field-addressed issues and no Plan. Validation requires:

- the Primary Provider to exist and support `processing`;
- all selected Provider and role values to resolve successfully;
- disabled Refine to require no other Refine fields;
- separate Refine to name a Provider that supports `refine` and to provide `fallback` or `abort` as `onError`;
- integrated Refine to omit Refine Provider, Refine values, and `onError`, and to have an effective primary `integratedRefine` Capability of `true`.

The orchestration can remain a function such as `buildExecutionPlan()`. It is not a workflow engine, routing framework, optimizer, graph planner, or strategy framework.

## Plans

### Refine disabled

```text
Plan
`-- Step 1
    role: processing
    input: audio
    Provider: primary
    Instructions: none

Audio --> Primary Processor --> Final Text
```

Exactly one Processor call occurs.

### Separate Refine

```text
Plan
|-- Step 1
|   role: processing
|   input: audio
|   Provider: primary
|   Context: attempt snapshot, capability-filtered
|   Instructions: none
|
`-- Step 2
    role: refine
    input: Step 1 text
    Provider: config.refine.provider
    Context: attempt snapshot, capability-filtered
    Instructions: config.refine.instructions
    onError: config.refine.onError

Audio --> Primary Processor --> Text --> Refine Processor --> Final Text
```

The configured Refine Provider is authoritative. If Qwen is primary and MiMo is configured for separate Refine, execution is Qwen then MiMo even if Qwen supports integrated Refine.

### Integrated Refine

```text
Plan
`-- Step 1
    role: processing
    input: audio
    Provider: primary
    Context: one attempt snapshot, capability-filtered
    Instructions: config.refine.instructions
    integratedRefine: true

Audio + Context + Instructions --> Primary Processor --> Final Text
```

Exactly one Processor call occurs. No Refine Processor is created. If the primary effective Capability has `integratedRefine: false`, Config is invalid. The Kernel never silently converts integrated Refine to separate Refine.

There is no `auto` execution value and no automatic fusion or routing.

## Context

Context is an immutable snapshot supplied by the Host for one processing attempt:

```javascript
const context = {
  text: ''
}
```

Context is attempt input, not processing Config. The Host constructs one snapshot per attempt; the Kernel delivers the text to a Processor only when its resolved capabilities support Context. A Processor without Context support receives empty Context — this is never a validation error.

The Context is one free-text string the user composes: terms, background, names — anything that helps interpretation. It is delivered verbatim; the product never reformats or re-templates it, because the user's own phrasing is the value. Structured forms (`terms`/`passages`) were rejected for deciding things the user should decide (how to present terminology, which parts are "background").

The GNOME Host constructs its snapshot from the user's Context setting (a Host setting, not part of processing Config). Empty Context is valid and changes neither Config validity nor execution shape.

Providers never acquire Context and never inspect the desktop, editor, clipboard, filesystem, history, or focused application. The Host performs no automatic environmental capture: only the text the user explicitly wrote is sent, to Providers that support it.

## Instructions

Instructions belong to Refine Config. The Kernel treats their content as opaque.

- separate Refine sends them to the Refine Processor;
- integrated Refine sends them to the Primary Processor;
- disabled Refine sends no Instructions.

The Kernel does not model translation, cleanup, formatting, or any other instruction meaning as a built-in operation.

## Settings

The settings page presents the product model directly:

```text
Provider
Provider fields
Model
Language
...

Context                                     (Host Context text source)

Refine                                      [toggle, nested in voice processing]

  Execution                                separate | integrated
  Provider                                 separate only
  Provider fields                          separate only
  Model                                    separate only
  Instructions
  Failure behavior                         separate only
```

There is no per-role Context selection UI: the Host constructs one attempt Context snapshot from the user's Context text, and each Processor receives it only when its capabilities allow. The Context group is visible only when an active role (primary, or an enabled Refine) consumes it.

There is no redundant Transcription section and no user-facing Step or Kind.

Preferences enumerate registered Providers and render generic controls from their Manifests:

```text
registered Providers
        |
        v
     Manifest
        |
        v
generic renderer <--> user values
        |
        v
 Provider.resolve()
        |
        +--> field issues
        `--> effective capabilities
```

When separate Refine is selected, Preferences lists Providers with a `refine` Manifest section and requires a Refine Provider. When integrated Refine is selected, Refine Provider and model fields are absent; Preferences validates the Primary Provider's effective `integratedRefine` Capability.

Provider-level fields are edited once per Provider id. If MiMo is selected for both roles, its endpoint and credential appear once while the primary and Refine model fields remain independent.

Adding a Provider requires registration, its Manifest, implementation, mappings, and tests. It requires no provider-specific Preferences branch such as `if (provider === 'qwen')`.

## Persistence

The GNOME Host uses generic storage:

- one GSettings key per Config field (`primary-provider`, `primary-model`, `primary-endpoint`, `refine-enabled`, `refine-provider`, `refine-model`, `refine-endpoint`, `refine-instructions`, `refine-on-error`), excluding all secret values;
- `provider-secrets`: a string map containing stored Provider secrets;
- `context`: Host-owned free-text Context, attempt input rather than Config.

No Provider field gets its own GSettings schema key beyond the generic role keys above. The complete Config shape is used immediately because toas has not been formally released. There is no Config version, Manifest revision, Step id, migration function, upgrade framework, or compatibility layer.

Config contains neither secret values nor secret references. A secret storage key is derived deterministically from Provider id and field key:

```text
providers/qwen/key
providers/mimo/key
```

Primary processing and separate Refine share the same secret when they use the same Provider.

Environment access belongs to the Host. Manifest fields may declare environment fallbacks, but Providers never read environment variables directly.

Non-secret value precedence is:

```text
stored user value
    -> environment fallback
    -> Manifest default
```

Secret precedence is:

```text
stored Provider secret
    -> environment fallback
    -> missing
```

The Host passes `secretPresence` to `Provider.resolve()` and resolved secret values only to `Provider.create()`. Secrets never enter Config, Result, Trace, diagnostics, logs, or history.

## Failure

Primary processing failure fails the whole processing attempt.

Separate Refine supports two explicit policies:

- `fallback`: return primary text and a warning when Refine fails;
- `abort`: fail the whole processing attempt when Refine fails.

Integrated Refine has one Processor call. Its failure is therefore a primary processing failure and fails the whole attempt.

The Kernel cannot infer a safe policy from Instructions. It performs exactly the configured policy.

## Result and Trace

The Kernel returns:

```javascript
const result = {
  text: 'final text',
  trace: [],
  warning: null
}
```

Trace records actual physical execution, not the logical Config.

Separate example:

```javascript
const trace = [
  {
    role: 'primary',
    provider: 'qwen',
    model: 'qwen3-asr-flash',
    input: 'audio',
    text: 'primary text',
    status: 'ok',
    elapsedMs: 647,
    usage: null,
    requestId: null,
    responseId: 'response-1'
  },
  {
    role: 'refine',
    provider: 'mimo',
    model: 'mimo-text-model',
    input: 'text',
    text: 'final text',
    status: 'ok',
    elapsedMs: 900,
    usage: null,
    requestId: null,
    responseId: 'response-2'
  }
]
```

Integrated example:

```javascript
const trace = [
  {
    role: 'primary',
    provider: 'qwen',
    model: 'instruction-aware-audio-model',
    input: 'audio',
    text: 'final text',
    status: 'ok',
    elapsedMs: 647,
    integratedRefine: true,
    usage: null,
    requestId: null,
    responseId: 'response-1'
  }
]
```

Trace may contain only normalized safe fields:

- role, Provider, model, and input kind;
- Step text, status, and elapsed time;
- Context form names, not contents;
- normalized usage;
- safe request and response ids;
- a safe error summary for a failed Step.

Trace never contains credentials, authorization headers, raw HTTP bodies, Context contents, duplicate Instructions, or arbitrary provider metadata.

The Kernel does not promise `rawText` or `refinedText`. Integrated Refine has no physical intermediate text boundary. History persists final text and Trace.

## Boundaries

The Host owns:

- recording and audio-file lifecycle;
- conversion to portable audio bytes;
- Preferences and Config persistence;
- secret storage and environment access;
- Context acquisition and consent;
- `HttpTransport` and Clock implementations;
- output, notifications, and history.

The Kernel owns:

- registered Providers and Manifests;
- Config resolution and validation;
- Provider and Processor creation;
- Plan construction and execution;
- failure policy, Result, and Trace construction.

Providers own only their service integration. They contain no GNOME imports. Replacing the Host does not change Provider, Processor, Config resolution, or Plan construction.

## Acceptance checks

All required scenarios follow from Config resolution without provider-specific orchestration.

| Requirement | Verification | Result |
| --- | --- | --- |
| Qwen only | Refine disabled builds one primary audio Step. | Pass |
| Qwen to MiMo | Separate Refine builds a Qwen processing Step followed by a MiMo Refine Step. | Pass |
| MiMo to OpenAI | The same role-based resolution builds MiMo processing followed by OpenAI Refine. | Pass |
| MiMo to MiMo | Both roles resolve through one MiMo Provider entry, one shared Provider value set, and one deterministic secret set; role models remain independent. | Pass |
| Integrated Refine | `integratedRefine: true` plus explicit `execution: 'integrated'` builds one primary Step carrying Refine Instructions. | Pass |
| Unsupported integrated Refine | `integratedRefine: false` produces a validation issue and no Plan. | Pass |
| Explicit separate is authoritative | Separate always builds the configured Refine Step even when primary supports integrated Refine. | Pass |
| New Provider locality | A new Provider needs only its module, Manifest, Processors, protocol mappings, tests, and registration. Generic settings, Kernel, HTTP, other Providers, and GSettings schema do not change. | Pass |
| Runtime replacement | Replacing `SoupHttpTransport` with `FetchHttpTransport` leaves Providers, Processors, resolution, and Plans unchanged. | Pass |
| Empty Context | Empty `text` is valid for all execution strategies. | Pass |

## Rejected alternatives

### Provider-owned Pipeline

It breaks cross-provider composition and makes Providers aware of one another.

### Separate same-vendor Providers

`MiMoAsrProvider` and `MiMoRefineProvider` would duplicate endpoint, credentials, authentication, protocol knowledge, and errors. One MiMo Provider supports both roles.

### Persisted physical Steps

A `steps` array exposes execution mechanics as product configuration and cannot express Refine as an optional product enhancement cleanly. Steps exist only in Plan and Trace.

### User-facing Kind

Users select the Primary Provider and optional Refine strategy. Internal role-specific resolution is sufficient; another configuration hierarchy adds no product value.

### Automatic fusion or routing

It can silently skip a configured Refine Provider and alter cost, latency, and semantics. Only explicit `separate` and `integrated` execution exist.

### Provider-owned HTTP clients

Provider imports of Soup or `fetch` couple protocol code to a Host and duplicate network policy. Providers use Host `HttpTransport`.

### Host-owned provider payloads

Provider-specific payload construction in the Host breaks locality and makes the Host know every service protocol.

### Generic transport framework

Only HTTP is required. WebSocket, gRPC, and a protocol-neutral Transport abstraction are deferred until a demonstrated requirement exists.

### Migration framework

There is no released persisted contract to migrate. The final Config shape replaces the current development shape directly.

### Additional infrastructure

Multiple accounts, Connection entities, plugin loading, dynamic Provider installation, arbitrary Pipelines, DAGs, workflow engines, Auto Refine, remote capability discovery, model capability guessing, and per-Step credentials are all explicitly deferred.

## Consequences

- The product remains simple: one Provider plus optional Refine.
- Physical execution remains explicit and observable without leaking into settings.
- Cross-provider and same-provider Refine use the same Kernel path.
- Provider code remains cohesive and vertically local.
- Shared Provider settings and credentials are stored once.
- Preferences are dynamic but generic because Manifests are declarative.
- The Host controls HTTP, persistence, secrets, Context, and user interaction.
- Context acquisition can remain unimplemented without weakening the interfaces.
- Provider capabilities never trigger implicit optimization.
