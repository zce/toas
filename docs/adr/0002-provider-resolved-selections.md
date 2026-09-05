# Providers resolve selections, not product roles

Status: accepted

A Provider represents one service integration and resolves a Selection—shared Provider values plus model and Provider-specific values—into opaque executable configuration and explicit capabilities. `primary` and `refine` remain Product Config and Kernel roles; they do not enter `Provider.resolve()` or `Provider.create()`. Model is a value inside Selection, not a first-class domain entity.

Resolved capabilities are authoritative and minimally declare `inputs`, text `instructions`, `context`, and the separately verified `integratedRefine` semantic. A Manifest declares only a static discovery upper bound and editable fields. Kernel predicates validate that Primary accepts audio, separate Refine accepts text and Instructions, and integrated Refine explicitly advertises `integratedRefine`.

Provider implementation remains local: Qwen maps known models to protocol and endpoint and rejects unmapped models; MiMo maps `mimo-v2.5-asr` to audio and `mimo-v2.5` / `mimo-v2.5-pro` to its OpenAI-compatible text contract; OpenAI and OpenAI-compatible expose text contracts, with the latter allowing arbitrary model identifiers. Protocol discriminators remain private implementation details.

Processing Config is persisted as one generic JSON document containing Product Roles, Selection values, and shared non-secret Provider values. Secrets and Host Context remain separate. Adding a Provider may require its module, Manifest, registration, and tests, but no Provider-specific GSettings key, enum, ConfigService mapping, or Preferences branch.

No Family, Model Registry, Catalog, Offering, Kind, Mode, Variant, public Strategy, capability query framework, remote discovery, or automatic routing is introduced.
