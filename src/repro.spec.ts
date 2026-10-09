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
