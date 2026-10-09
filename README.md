# typescript-go checker hangs in getReturnTypeOfSignature (via tsgolint) on recursive overload type

`oxlint --type-aware` never finishes (tsgolint at 100 % CPU) on `src/repro.spec.ts`.
`tsc --noEmit` and `tsgo --noEmit` finish in ~1 s without errors.

    npm install
    npm run tsc    # ok, ~1 s
    npm run lint   # hangs forever

Rules: `typescript/no-misused-promises` and `typescript/strict-void-return` each hang on their own;
all other type-aware rules finish in ~1 s.

Works when either:
- type-fest is <= 4.30.2, or
- `IsEqual` is replaced with the type-fest 4.30.2 definition
  `(<G>() => G extends A ? 1 : 2) extends (<G>() => G extends B ? 1 : 2) ? true : false`.
  type-fest 4.31.0 changed it to `G extends A & G | G`.

All of these are needed to reproduce: the recursive `PromisifyInner` (stops via `IsEqual`), the `Client` class with
a `call` getter, a generic `createHandler` constrained to `ProcedureTree`, and `expect(vi.mocked(createHandler))`.

The stack (`stack.txt`) shows the loop is in the typescript-go checker (inferFromTypes ⇄ inferFromTypeArguments under
getReturnTypeOfSignature). tsc 5.9 resolves the same requests in ~80 ms: `node api-probe.cjs`.
