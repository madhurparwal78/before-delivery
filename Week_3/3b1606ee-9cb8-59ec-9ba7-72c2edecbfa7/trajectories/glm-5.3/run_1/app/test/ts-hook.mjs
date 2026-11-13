// Test-only loader hook: lets Node's type-stripping loader follow the compiled-output
// `.js` specifiers to their `.ts` sources.
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    if (specifier.endsWith('.js')) {
      return await next(`${specifier.slice(0, -3)}.ts`, context);
    }
    throw error;
  }
}
