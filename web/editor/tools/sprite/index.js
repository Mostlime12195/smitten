// Sprite editor (placeholder).

export default {
  id: 'sprite',
  label: 'Sprite editor',
  match: (path) => /\.(png|sprite\.json)$/i.test(path),
  newAssets: [],
  open(host) {
    const element = host.ui.h('div', { class: 'tool-placeholder' }, `${host.path} opens in the sprite editor, which isn't built yet.`);
    return { element, async save() {} };
  },
};
