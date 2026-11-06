---
name: TanStack runtime compatibility
description: Runtime and package-lock constraints for this project's TanStack Start build.
---

Keep TanStack Start, React Router, and the router plugin on compatible versions, and run the project on Node 22 or newer. Keep the npm and Bun lockfiles synchronized when changing dependencies.

**Why:** This project’s server build failed when only one TanStack package was upgraded, and its older package version could not be fetched through the Replit package firewall. Aligning the package line and using Node 22 produced a successful production build.

**How to apply:** When changing the TanStack Start toolchain, verify the complete production build and frozen installs for both package managers.
