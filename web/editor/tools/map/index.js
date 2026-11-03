// Map editor (placeholder).

export default {
  id: 'map',
  label: 'Map editor',
  match: (path) => /\.(map|tileset)\.json$/i.test(path),
  newAssets: [],
  open(host) {
    const element = host.ui.h('div', { class: 'tool-placeholder' }, `${host.path} opens in the map editor, which isn't built yet.`);
    return { element, async save() {} };
  },
};
