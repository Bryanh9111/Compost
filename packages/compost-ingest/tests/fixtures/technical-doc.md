# Cache Components in Next.js 16

Next.js 16 introduces Cache Components, a new way to handle data caching at the component level.

## The use cache Directive

The `use cache` directive marks a component or function for caching. It replaces the older `unstable_cache` API.

### Benefits

- Automatic cache invalidation via tags
- PPR (Partial Prerendering) support
- Simplified mental model

## Migration from unstable_cache

Replace `unstable_cache` calls with `use cache` directives. The `cacheLife` and `cacheTag` APIs control behavior.
