### Checker never terminates in `getReturnTypeOfSignature` (inference recursion) on overload-walking type; tsc 5.9 resolves it in milliseconds

**Versions**
- typescript-go as bundled in `oxlint-tsgolint@7.0.2003` (also 0.24.0, 0.25.0); `@typescript/native-preview@7.0.0-dev.20260707.2` for `tsgo --noEmit`
- typescript 5.9.3 for comparison
- macOS arm64

**What happens**
- `checker.getReturnTypeOfSignature` never returns: 100 % CPU indefinitely (observed >20 min).
- It is reached through the type-aware linter tsgolint, rule `no-misused-promises` (also `strict-void-return`). The rule only asks for the return type of a call signature.
- `tsgo --noEmit` on the same project finishes in ~1 s with no errors, because the plain check never requests this return type.

**tsc 5.9.3 does not hang on the same requests**

Through the TS API, I requested the return type of every call signature of every expression and its properties in the file. That is a superset of what the lint rule requests. All 1709 resolved in 79 ms (script below).

**The type itself terminates**

Forcing `Promisify` on concrete overloaded functions (1, 2 and 3 overloads, generic overloads) type-checks correctly in both `tsc` and `tsgo`. `tsc` reports 4174 instantiations.

**Trigger**

A recursive type walks function overloads and stops when `IsEqual<Current, Previous>` is `true`.
- With the type-fest 4.31+ `IsEqual`, `<G>() => G extends A & G | G ? 1 : 2`, it hangs.
- With the older form, `<G>() => G extends A ? 1 : 2`, it finishes in ~1 s.

All of these are needed to reproduce. Removing any one makes it finish:
- the recursive `PromisifyInner`,
- the `Client` class with a `call` getter,
- the generic `createHandler` constrained to `ProcedureTree`,
- `expect(vi.mocked(createHandler))` (vitest's `MockedFunction` type).

**Stack** (SIGQUIT on the hung process, trimmed; full dump attached as `stack.txt`):
```
tsgolint/internal/rules/no_misused_promises ...
typescript-go/internal/checker.(*Checker).getReturnTypeOfSignature
  .instantiateType → .instantiateTypeWithAlias → .instantiateTypeWorker
  .getConditionalTypeInstantiation → .getConditionalType
  ...458 frames elided...
  .inferFromTypes            (inference.go:89 / :98)
  .inferFromTypeArguments    (inference.go:311)
  .inferFromTypes
  .inferFromTypeArguments
  ... (repeats, same source/target pointers on each inferFromTypes call)
  .fillMissingTypeArguments  (checker.go:21859)
```

**Expected**

The checker terminates like tsc does. If the type is too deep, it should report or bail out at the instantiation and depth limits, not loop.

---

**Repro**

```
npm i
npx tsc --noEmit               # ok, ~1 s
npx oxlint --type-aware src    # never finishes
```

`package.json` devDependencies: `oxlint@1.86.0`, `oxlint-tsgolint@7.0.2003`, `type-fest@4.41.0`, `typescript@5.9.3`, `vitest@4.1.3`

`.oxlintrc.json`
```json
{"plugins":["typescript"],"categories":{"correctness":"off"},"rules":{"typescript/no-misused-promises":"error"}}
```

`tsconfig.json`
```json
{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"Bundler","strict":true,"noEmit":true,"skipLibCheck":true},"include":["src"]}
```

`src/repro.spec.ts`
```ts
import type { Asyncify, IsEqual, PartialDeep } from 'type-fest';
import { expect, vi } from 'vitest';

type Fn = (...args: any) => any;
type FirstOverload<TFn extends Fn> = (...args: Parameters<TFn>) => ReturnType<TFn>;
type NextOverload<TFn extends Fn, TStack extends Fn> = (...args: Parameters<TStack & TFn>) => ReturnType<TStack & TFn>;
type SafeAsyncify<TFn extends Fn> = ReturnType<TFn> extends Promise<unknown> ? TFn : Asyncify<TFn>;

// Collects all overloads of TFn; recursion stops once the next overload equals the previous one.
type PromisifyInner<TFn extends Fn, TAcc extends Fn, TStack extends Fn, TPrevious extends Fn, TCurrent extends Fn = NextOverload<TFn, TStack>> =
	IsEqual<TCurrent, TPrevious> extends true ? TAcc : PromisifyInner<TFn, TAcc & SafeAsyncify<TCurrent>, TCurrent & TStack, TCurrent>;
type Promisify<TFn extends Fn, TFirst extends Fn = FirstOverload<TFn>> = PromisifyInner<TFn, SafeAsyncify<TFirst>, TFirst, TFirst>;

type IfThenElse<C, T, F> = false extends C ? F : T;
type OwnProperties<T> = { [K in keyof T]: T[K] };
type AddOptionalRequestOptions<TFn> = TFn extends (...args: [...infer TArgs]) => infer TReturn
	? ((...args: [...TArgs, requestOptions?: { timeout?: number }]) => TReturn) & TFn
	: TFn;

type PromisifyProcedureTree<T> = T extends Fn
	? ReturnType<T> extends Promise<unknown>
		? AddOptionalRequestOptions<T>
		: IfThenElse<
				keyof OwnProperties<T> extends never ? true : false,
				AddOptionalRequestOptions<Promisify<T>>,
				AddOptionalRequestOptions<Promisify<T>> & PromisifyProcedureTree<OwnProperties<T>>
			>
	: T extends Record<string, unknown>
		? { readonly [K in keyof T]: PromisifyProcedureTree<T[K]> }
		: T;

type ProtocolValue = null | string | number | boolean | Date | readonly ProtocolValue[] | { readonly [key: string]: ProtocolValue };

type ProcedureTree<TProtocolValue> = {
	readonly [key: string | number]:
		| ProcedureTree<TProtocolValue>
		| ((...args: never[]) => void | PartialDeep<TProtocolValue> | Promise<void | PartialDeep<TProtocolValue>>);
};

declare class Client<TTree> {
	get call(): PromisifyProcedureTree<TTree>;
}

declare function createHandler<TTree extends ProcedureTree<ProtocolValue>>(): (client: Client<TTree>) => void;

expect(vi.mocked(createHandler)).toHaveBeenCalledTimes(1);
```

**tsc API comparison** (`node api-probe.cjs`, finishes in ~80 ms)
```js
const ts = require('typescript');
const cfg = ts.getParsedCommandLineOfConfigFile('./tsconfig.json', {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} });
const program = ts.createProgram(cfg.fileNames, cfg.options);
const checker = program.getTypeChecker();
const sf = program.getSourceFile('./src/repro.spec.ts');
let n = 0;
const t0 = Date.now();
(function visit(node) {
	if (ts.isExpression(node)) {
		const type = checker.getTypeAtLocation(node);
		for (const part of type.isUnion() ? type.types : [type]) {
			for (const sig of part.getCallSignatures()) { checker.getReturnTypeOfSignature(sig); n++; }
			for (const prop of part.getProperties()) {
				const pt = checker.getTypeOfSymbolAtLocation(prop, node);
				for (const sig of pt.getCallSignatures()) { checker.getReturnTypeOfSignature(sig); n++; }
			}
		}
	}
	ts.forEachChild(node, visit);
})(sf);
console.log(`tsc ${ts.version} API: ${n} return types resolved in ${Date.now() - t0} ms`);
```
