# 0001 TypeScript 6, ESLint 9, Playwright 1.63
- Context: TypeScript 7 (the native port) is the npm "latest" tag as of 23 Nov 2026, but typescript-eslint 8.74 supports TypeScript below 6.1 only, and eslint-config-next 16.4 needs typescript-eslint. ESLint 10 is out, but eslint-plugin-react supports up to ESLint 9.
- Options: TypeScript 7 without type-aware lint; TypeScript 6.0 with the full Next lint set.
- Choice: TypeScript 6.0.3, ESLint 9.39, Next 16.4.6, React 19.3, Tailwind 4.3, Zod 4.6, Vitest 5.1. Playwright pinned to 1.63.0 to match the browser build the dev containers ship with.
- Reason: The lint rules that enforce tokens and lane boundaries matter more than compiler speed today.
- Consequence: Revisit when typescript-eslint supports TypeScript 7.
