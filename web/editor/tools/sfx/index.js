// Sound editor (placeholder).

export default {
  id: 'sfx',
  label: 'Sound editor',
  match: (path) => /\.sfx\.json$/i.test(path),
  newAssets: [],
  open(host) {
    const element = host.ui.h('div', { class: 'tool-placeholder' }, `${host.path} opens in the sound editor, which isn't built yet.`);
    return { element, async save() {} };
  },
};
