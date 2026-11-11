# Michigan Mold Maker

Design 3D-printable ceramic molds shaped like Michigan's **Lower** or **Upper Peninsula** or one of the **Great Lakes**
(Superior, Michigan, Huron, Erie, Ontario), sized for a spoon rest.

- **Drape (hump) mold**: lay a clay slab over it. It's mirrored so the finished dish reads correctly.
  Optional threaded socket and screw-in stand.
- **Slump mold**: press a clay slab into the cavity.
- Live 3D preview; downloads a `.zip` with the STL files, your settings and printing notes.

Everything runs in the browser (WebAssembly geometry engine). There's no server and nothing to install.

## Put it on GitHub Pages

1. Create a new repository on GitHub (for example `michigan-mold-maker`).
2. Upload **everything in this folder** to the repository root, including the `vendor` folder
   and the hidden `.nojekyll` file. (Drag-and-drop on the repo's "Add file → Upload files" page works;
   in the macOS Finder press **Cmd-Shift-.** to show hidden files.)
3. In the repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   branch **main**, folder **/ (root)**, then **Save**.
4. After a minute or two the site is live at `https://<your-username>.github.io/michigan-mold-maker/`.

## Run it on your own computer

Browsers won't load the WebAssembly engine from a double-clicked file, so serve the folder:

```bash
cd michigan-mold-maker
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Files

| File | What it is |
|---|---|
| `index.html` | Page layout and styles |
| `app.js` | Controls, geometry, 3D preview, STL and zip export |
| `outlines.js` | Peninsula and Great Lakes outlines |
| `vendor/manifold/` | [Manifold](https://github.com/elalish/manifold) geometry engine, v3.5.4 (Apache-2.0) |
| `vendor/three/` | [three.js](https://threejs.org) r160 for the 3D preview (MIT) |

## Printing notes

- Molds print flat side down with no supports; 3 walls, 10–15% infill.
- The stand prints upright with no supports; use 3–4 walls so the stud is strong.
- If the threads are tight, raise **Thread clearance** and regenerate *both* parts.
- Clay doesn't release from plastic on its own: use plastic wrap, thin cloth, or cornstarch.

## Credits

Peninsula outlines: US Census state boundary via [glynnbird/usstatesgeojson](https://github.com/glynnbird/usstatesgeojson).
Great Lakes outlines: [Natural Earth](https://www.naturalearthdata.com) 1:10m lakes (public domain), islands filled in.
