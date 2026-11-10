import type { EventSourcePlusOptions } from 'event-source-plus';

export async function getHeaders(
    input: EventSourcePlusOptions['headers'],
): Promise<Record<string, string>> {
    if (typeof input === 'function') {
        const result = input();
        if ('then' in result && typeof result.then === 'function') {
            return (result as Promise<any>).then((data: any) => data as Record<string, string>);
        }
        return result as Record<string, string>;
    }
    return (input ?? {}) as Record<string, string>;
}
