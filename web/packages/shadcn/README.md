# @wuhu/shadcn

shadcn/ui components package for the Wuhu web workspace, set up with the shadcn
CLI and Tailwind CSS v4.

## Setup Process

This package was created using `deno x shadcn@latest` (Deno 2.6's equivalent of
`npx`).

### Prerequisites

- Deno 2.6+ (for `deno x` command)
- The package needs both `deno.json` (for Deno workspace) and `package.json`
  (for shadcn CLI compatibility)
- A `tsconfig.json` is required for the CLI but not used by Deno at runtime

### Initial Setup

1. Created the package directory structure:
   ```
   packages/shadcn/
   ├── components/     # shadcn UI components
   ├── lib/            # Utilities (cn function)
   ├── globals.css     # Tailwind CSS + shadcn theme
   ├── deno.json       # Deno workspace config
   ├── package.json    # For shadcn CLI
   ├── tsconfig.json   # For shadcn CLI
   └── components.json # shadcn CLI config
   ```

2. Created `components.json` for the shadcn CLI:
   ```json
   {
     "$schema": "https://ui.shadcn.com/schema.json",
     "style": "new-york",
     "rsc": false,
     "tsx": true,
     "tailwind": {
       "config": "",
       "css": "globals.css",
       "baseColor": "neutral",
       "cssVariables": true
     },
     "iconLibrary": "lucide",
     "aliases": {
       "components": "@/components",
       "utils": "@/lib/utils",
       "ui": "@/components",
       "lib": "@/lib",
       "hooks": "@/hooks"
     }
   }
   ```

3. Added the package to the workspace in `web/deno.json`:
   ```json
   "workspace": [
     "./packages/react-router-deno",
     "./packages/app",
     "./packages/shadcn"
   ]
   ```

### Installing Components

Use `deno x shadcn@latest add <component>` from the shadcn directory:

```bash
cd web/packages/shadcn
deno x shadcn@latest add button card input textarea select label badge --yes
```

The CLI:

- Downloads component code to `components/`
- Updates `package.json` with dependencies (e.g., `radix-ui`)
- Components use `@/lib/utils` import which is mapped in `deno.json`

### Key Configuration

**deno.json** - Maps imports for Deno:

```json
{
  "imports": {
    "@/lib/utils": "./lib/utils.ts",
    "radix-ui": "npm:radix-ui@^1.4.3",
    "tw-animate-css": "npm:tw-animate-css@^1",
    "tailwindcss": "npm:tailwindcss@^4"
    // ... other deps
  },
  "exports": {
    "./globals.css": "./globals.css",
    "./components/button": "./components/button.tsx"
    // ... other components
  }
}
```

**globals.css** - Tailwind v4 with shadcn theme:

- Uses `@import "tailwindcss"` (Tailwind v4 style)
- Uses `@import "tw-animate-css"` for animations
- `@source "components"` to scan components directory
- CSS variables for theming (OKLCH colors)
- `@theme inline` for Tailwind color mapping

## Usage in the App

1. Import the globals.css in `app/root.tsx`:
   ```tsx
   import '@wuhu/shadcn/globals.css'
   ```

2. Import components:
   ```tsx
   import { Button } from '@wuhu/shadcn/components/button'
   import { Card, CardContent } from '@wuhu/shadcn/components/card'
   ```

3. Add Tailwind vite plugin in `vite.config.ts`:
   ```ts
   import tailwindcss from '@tailwindcss/vite'

   export default {
     plugins: [tailwindcss(), ...],
   }
   ```

## Issues Encountered

### 1. shadcn CLI requires tsconfig.json

The CLI fails without a `tsconfig.json` file. Created a minimal one with path
aliases.

### 2. shadcn CLI requires package.json

The CLI prompts to create a new project without `package.json`. Created one with
dependencies.

### 3. rolldown-vite incompatibility

The experimental `rolldown-vite` caused Deno panics with `@tailwindcss/vite`.
**Solution**: Changed to standard `vite@^7`.

### 4. Missing tw-animate-css

Tailwind v4 shadcn uses `tw-animate-css` instead of `tailwindcss-animate`.
**Solution**: Added to `deno.json` imports.

### 5. Dev server file watcher issue

The dev server has a pre-existing issue with Deno's file watcher. Build works
fine.

## Adding New Components

```bash
cd web/packages/shadcn
deno x shadcn@latest add <component-name> --yes
```

Then update `deno.json` exports:

```json
"exports": {
  "./components/<name>": "./components/<name>.tsx"
}
```

## Component Customization

The shadcn philosophy is "copy and own" - the component code is yours to modify.
However, to keep updates easy, prefer:

1. Using the `className` prop for style overrides
2. Creating wrapper components in your app
3. Only modifying the source when necessary
