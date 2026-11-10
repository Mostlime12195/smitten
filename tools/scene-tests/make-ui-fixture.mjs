// Writes tools/scene-tests/ui/layout-cases.json: small trees of UI pieces
// and the rectangle each piece must end up with, on a 640×360 screen.
//
//   node tools/scene-tests/make-ui-fixture.mjs
//
// The rectangles come from the editor's layout (uilayout.js). The engine is
// checked against the same file three ways: tools/ui-tests/test.lua (the
// engine's Lua under plain Lua 5.1), the "ui" scene test (the built engine)
// and web/editor/workspaces/scene/uilayout.test.mjs, which also works a few
// of them out by hand.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layoutTree } from '../../web/editor/workspaces/scene/uilayout.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const schema = JSON.parse(readFileSync(join(root, 'love/src/modules/scene/pieces.json'), 'utf8'));

/** The layout api over plain { name, type, props, children } trees. */
export function treeApi(types) {
  const lineage = (type) => {
    const out = [];
    for (let t = type; t && types[t]; t = types[t].extends) out.push(t);
    return out;
  };
  return {
    type: (n) => n.type,
    children: (n) => n.children || [],
    isUI: (n) => lineage(n.type).includes('UI'),
    get: (n, p) => {
      if (n.props && p in n.props) return n.props[p];
      for (const t of lineage(n.type)) {
        const d = types[t].properties?.[p];
        if (d) return d.default;
      }
      return undefined;
    },
    visible(n) { return this.get(n, 'visible') !== false; },
  };
}

const P = (name, type, props = {}, children = []) => ({ name, type, props, children });
const box = (name, width, height, more = {}) => P(name, 'Panel', { width, height, ...more });

const CASES = [
  ['row: pieces left to right, in the middle of the tallest', [
    P('Row', 'Row', { x: 10, y: 20 }, [box('A', 60, 30), box('B', 80, 40), box('C', 40, 20)]),
  ]],
  ['row: gap and padding', [
    P('Row', 'Row', { gap: 3, padding: 12 }, [box('A', 60, 30), box('B', 80, 40)]),
  ]],
  ['row: a set size, justify center, align start', [
    P('Row', 'Row', { width: 300, height: 60, justify: 'center', alignItems: 'start' }, [box('A', 60, 30), box('B', 80, 40)]),
  ]],
  ['row: justify end, align end', [
    P('Row', 'Row', { width: 300, height: 60, justify: 'end', alignItems: 'end' }, [box('A', 60, 30), box('B', 80, 40)]),
  ]],
  ['row: spaceBetween, stretch', [
    P('Row', 'Row', { width: 300, height: 60, justify: 'spaceBetween', alignItems: 'stretch' }, [box('A', 60, 30), box('B', 80, 40), box('C', 40, 20)]),
  ]],
  ['row: grow shares what is left', [
    P('Row', 'Row', { width: 300, height: 40 }, [box('A', 60, 30), box('B', 20, 30, { grow: 1 }), box('C', 20, 30, { grow: 2 })]),
  ]],
  ['row: thirds land on whole pixels', [
    P('Row', 'Row', { width: 100, height: 20, gap: 0 }, [box('A', 0, 10, { grow: 1 }), box('B', 0, 10, { grow: 1 }), box('C', 0, 10, { grow: 1 })]),
  ]],
  ['row: too narrow, the pieces keep their size', [
    P('Row', 'Row', { width: 100, height: 40, justify: 'center' }, [box('A', 60, 30, { grow: 1 }), box('B', 60, 30)]),
  ]],
  ['row: a hidden piece takes no room', [
    P('Row', 'Row', {}, [box('A', 60, 30), box('Hidden', 50, 50, { visible: false }), box('B', 80, 40)]),
  ]],
  ['column: stretches to the widest', [
    P('Column', 'Column', { x: 5, y: 5 }, [box('A', 60, 30), box('B', 120, 40), box('C', 40, 20)]),
  ]],
  ['column: a set size, spaceBetween, align center', [
    P('Column', 'Column', { width: 200, height: 300, justify: 'spaceBetween', alignItems: 'center' }, [box('A', 60, 30), box('B', 120, 40), box('C', 40, 20)]),
  ]],
  ['column: grow and padding', [
    P('Column', 'Column', { width: 200, height: 300, padding: 10, gap: 5 }, [box('A', 60, 30), box('B', 120, 40, { grow: 1 }), box('C', 40, 20)]),
  ]],
  ['column: anchored bottom right, sized by what is inside', [
    P('Column', 'Column', { anchor: 'bottomRight', x: 16, y: 16, alignItems: 'end' }, [box('A', 60, 30), box('B', 120, 40)]),
  ]],
  ['column: fill, with a margin', [
    P('Column', 'Column', { anchor: 'fill', x: 20, y: 10, justify: 'end' }, [box('A', 60, 30), box('B', 120, 40)]),
  ]],
  ['grid: three columns as wide as the widest piece', [
    P('Grid', 'Grid', { columns: 3, x: 8, y: 8 }, [box('A', 40, 30), box('B', 60, 20), box('C', 50, 50), box('D', 30, 30), box('E', 20, 10), box('F', 60, 40), box('G', 10, 10)]),
  ]],
  ['grid: a set width is shared by the columns', [
    P('Grid', 'Grid', { columns: 2, width: 300, gap: 10, padding: 5 }, [box('A', 40, 30), box('B', 60, 20), box('C', 50, 50)]),
  ]],
  ['grid: pieces centered in their cells, rows at the bottom', [
    P('Grid', 'Grid', { columns: 2, width: 200, height: 200, alignItems: 'center', justify: 'end' }, [box('A', 40, 30), box('B', 60, 20), box('C', 50, 50), box('D', 10, 10)]),
  ]],
  ['grid: start and spaceBetween', [
    P('Grid', 'Grid', { columns: 2, width: 200, height: 200, alignItems: 'start', justify: 'spaceBetween' }, [box('A', 40, 30), box('B', 60, 20), box('C', 50, 50), box('D', 10, 10)]),
  ]],
  ['nested: a settings screen', [
    P('Panel', 'Panel', { anchor: 'center', width: 360, height: 240 }, [
      P('Menu', 'Column', { anchor: 'fill', x: 16, y: 16, gap: 12 }, [
        P('Title', 'Label', { height: 28 }),
        P('VolumeRow', 'Row', {}, [P('VolumeLabel', 'Label', { width: 100, height: 24 }), P('Volume', 'Slider', { grow: 1 })]),
        P('Fullscreen', 'Checkbox', {}),
        P('NameRow', 'Row', { gap: 4 }, [P('NameLabel', 'Label', { width: 100, height: 24 }), P('Name', 'TextInput', { grow: 1 })]),
        P('Buttons', 'Row', { justify: 'end' }, [P('Back', 'Button', { width: 90 }), P('Save', 'Button', { width: 90 })]),
      ]),
    ]),
  ]],
  ['nested: rows in a column in a row, all sized by what is inside', [
    P('Outer', 'Row', { x: 100, y: 50, padding: 4, alignItems: 'start' }, [
      box('Side', 30, 100),
      P('Stack', 'Column', { gap: 2 }, [
        P('Top', 'Row', { gap: 1 }, [box('A', 20, 20), box('B', 30, 10)]),
        P('Bottom', 'Row', { gap: 1 }, [box('C', 70, 20)]),
      ]),
    ]),
  ]],
  ['a piece placed by a row still places what is inside it by anchors', [
    P('Row', 'Row', { x: 50, y: 50 }, [
      box('A', 100, 80, {}),
      P('Card', 'Panel', { width: 120, height: 80 }, [P('Corner', 'Button', { anchor: 'bottomRight', x: 4, y: 4, width: 40, height: 20 }), P('Fill', 'Panel', { anchor: 'fill', x: 10, y: 10 })]),
    ]),
  ]],
  ['pieces inside a Group inside a row keep their anchors', [
    P('Row', 'Row', { x: 50, y: 50, width: 200, height: 100 }, [
      box('A', 40, 40),
      P('Holder', 'Group', {}, [P('Free', 'Panel', { anchor: 'bottomRight', x: 5, y: 5, width: 30, height: 30 })]),
      box('B', 40, 40),
    ]),
  ]],
  ['scroll: a list longer than it is, scrolled part of the way', [
    P('Scroll', 'Scroll', { x: 20, y: 20, width: 200, height: 100, scrollY: 50 }, [box('A', 60, 30), box('B', 60, 30), box('C', 60, 30), box('D', 60, 30), box('E', 60, 30), box('F', 60, 30)]),
  ]],
  ['scroll: never further than its end', [
    P('Scroll', 'Scroll', { x: 20, y: 20, width: 200, height: 100, scrollY: 9999, padding: 6, gap: 2 }, [box('A', 60, 30), box('B', 60, 30), box('C', 60, 30), box('D', 60, 30), box('E', 60, 30)]),
  ]],
  ['scroll: shorter than it is, it does not scroll', [
    P('Scroll', 'Scroll', { width: 200, height: 100, scrollY: 40 }, [box('A', 60, 30), box('B', 60, 30)]),
  ]],
  ['scroll: sideways', [
    P('Scroll', 'Scroll', { x: 10, y: 10, width: 150, height: 60, direction: 'horizontal', scrollX: 30, scrollY: 20 }, [box('A', 60, 30), box('B', 60, 30), box('C', 60, 30), box('D', 60, 30)]),
  ]],
  ['scroll: a grid inside it', [
    P('Scroll', 'Scroll', { width: 220, height: 100, scrollY: 20 }, [
      P('Grid', 'Grid', { columns: 4, gap: 4 }, [box('A', 40, 40), box('B', 40, 40), box('C', 40, 40), box('D', 40, 40), box('E', 40, 40), box('F', 40, 40), box('G', 40, 40), box('H', 40, 40), box('I', 40, 40)]),
    ]),
  ]],
  ['anchors alone are as they always were', [
    P('TopLeft', 'Panel', { x: 10, y: 20 }),
    P('Center', 'Button', { anchor: 'center', x: 5, y: -5, width: 100, height: 50 }),
    P('BottomRight', 'Bar', { anchor: 'bottomRight', x: 16, y: 16 }),
    P('Fill', 'Panel', { anchor: 'fill', x: 30, y: 40 }, [P('Inner', 'Label', { anchor: 'top', y: 8 }), P('Grown', 'Button', { anchor: 'right', x: 2, grow: 3 })]),
  ]],
];

export function solve(pieces, types, screen) {
  const expect = {};
  const top = { name: 'Screen', type: 'Group', props: {}, children: pieces };
  layoutTree(top, treeApi(types), screen[0], screen[1], (n, r) => {
    if (n.name in expect) throw new Error(`two pieces called ${n.name}`);
    expect[n.name] = r;
  });
  return expect;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const screen = [640, 360];
  const cases = CASES.map(([name, pieces]) => ({ name, pieces, expect: solve(pieces, schema.types, screen) }));
  const out = join(here, 'ui', 'layout-cases.json');
  const text = `{\n  "about": "Made by tools/scene-tests/make-ui-fixture.mjs: UI pieces and where each must be, as [x, y, width, height].",\n  "screen": ${JSON.stringify(screen)},\n  "cases": [\n${cases.map((c) => `    ${JSON.stringify(c)}`).join(',\n')}\n  ]\n}\n`;
  writeFileSync(out, text);
  console.log(`${out}: ${cases.length} cases`);
}
