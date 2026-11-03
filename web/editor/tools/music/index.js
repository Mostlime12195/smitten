// Music editor (placeholder).

export default {
  id: 'music',
  label: 'Music editor',
  match: (path) => /\.song\.json$/i.test(path),
  newAssets: [],
  open(host) {
    const element = host.ui.h('div', { class: 'tool-placeholder' }, `${host.path} opens in the music editor, which isn't built yet.`);
    return { element, async save() {} };
  },
};
