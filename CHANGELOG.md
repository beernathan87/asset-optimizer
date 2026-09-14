# Changelog

## 0.1.0 - 2026-09-14

First release: image audit + optimization (PNG/JPEG/WebP) with Unity/web/mobile/Discord/Steam/general presets, audio audit, markdown/JSON reports, local UI.

Production pass (2026-09-13): sharp upgraded 0.33 -> 0.35 (clears libvips/libheif advisories), npm tarball now excludes tests (`files` whitelist), strict CSP + framing/sniffing headers on the local UI, production corpus + golden regression tests (Unicode/space/nested paths, collisions, read-only, corrupt/zero/disguised inputs, junction skipping, originals-untouched hash check), CI on Ubuntu + Windows installing from the packed tarball, third-party notices including the LGPL libvips notice, benchmark documentation.
