// Brings scenes saved before Smitten's own pieces (the Godot-like names of
// the first rebuild: Node2D, Sprite2D, CharacterBody2D + CollisionShape2D,
// Platformer behavior nodes, groups...) up to date. 3D pieces are gone and
// are left out, with a note. Runs when a project opens.

const SIMPLE = {
  Node: 'Group', Node2D: 'Group', Sprite2D: 'Sprite', Shape2D: 'Shape', Text2D: 'Text', TileMap: 'Tiles',
  Camera2D: 'Camera', Particles2D: 'Particles', Area2D: 'Zone', CollisionShape2D: 'Hitbox', Joint2D: 'Joint',
  ImageRect: 'Picture', ProgressBar: 'Bar', AudioPlayer: 'Sound', Timer: 'Timer',
  Label: 'Label', Button: 'Button', Panel: 'Panel',
};
const BODIES = { CharacterBody2D: 'scripted', StaticBody2D: 'still', RigidBody2D: 'physics' };
const RENAMES = {
  Sprite: { hframes: 'columns', vframes: 'rows' },
  Camera: { current: 'active', limitLeft: 'left', limitTop: 'top', limitRight: 'right', limitBottom: 'bottom' },
  Particles: { oneShot: 'burst', localCoords: 'followPiece' },
  Tiles: { collision: 'solid' },
  Zone: { monitoring: 'active' },
  Hitbox: { disabled: 'off' },
  Joint: { nodeA: 'a', nodeB: 'b' },
  Body: { gravityScale: 'gravity', lockRotation: 'fixedRotation', linearDamping: 'drag', floorAngle: 'slope' },
  Timer: { wait: 'seconds', autostart: 'running' },
};
// Collision layers and masks became tags; z became layer (draw order).
const COLLISION_TYPES = new Set(['Body', 'Zone', 'Tiles', 'Hitbox']);
const DROP = new Set(['angularDamping', 'spin']);
// Behavior nodes became ready-made scripts.
const BEHAVIORS = { Platformer: 'platformer', TopDown: 'topdown', Follow: 'chase', Mover: 'fly', Spin: 'spin', Draggable: 'drag' };

/** True if a parsed scene uses the old names. */
export function needsMigration(data) {
  let old = false;
  const visit = (e) => {
    if (!e) return;
    if (e.groups || BODIES[e.type] || BEHAVIORS[e.type] || (e.type && e.type !== SIMPLE[e.type] && SIMPLE[e.type]) || /3D$/.test(e.type || '')) old = true;
    (e.children || []).forEach(visit);
  };
  visit(data?.root);
  return old;
}

/**
 * Converts a parsed scene in place. Returns { scripts: {id: true}, dropped: n }:
 * the ready-made scripts it attached (the caller copies them into the
 * project) and how many 3D pieces it left out.
 */
export function migrateScene(data) {
  const scripts = {};
  let dropped = 0;
  const convert = (e) => {
    if (e.groups) {
      e.tags = e.groups;
      delete e.groups;
    }
    const props = e.properties || {};
    if (BODIES[e.type]) {
      props.motion = BODIES[e.type];
      e.type = 'Body';
      // Collision shapes were children; a Body without them fits its look.
      const hitboxes = (e.children || []).filter((c) => c.type === 'CollisionShape2D');
      if (hitboxes.length) props.shape = 'none';
    } else if (e.type && SIMPLE[e.type]) {
      e.type = SIMPLE[e.type];
    }
    const renames = RENAMES[e.type] || {};
    for (const [from, to] of Object.entries(renames)) {
      if (from in props) {
        props[to] = props[from];
        delete props[from];
      }
    }
    if (e.type === 'Timer' && 'oneShot' in props) {
      props.loop = !props.oneShot;
      delete props.oneShot;
    }
    if (props.anchor === 'full') props.anchor = 'fill';
    if (COLLISION_TYPES.has(e.type)) {
      delete props.layer;
      delete props.mask;
    }
    if ('z' in props) {
      props.layer = props.z;
      delete props.z;
    }
    for (const k of DROP) delete props[k];
    if (Object.keys(props).length) e.properties = props;
    else delete e.properties;
    const kids = [];
    for (const c of e.children || []) {
      if (/3D$/.test(c.type || '') || c.type === 'FirstPerson') {
        dropped++;
        continue;
      }
      if (BEHAVIORS[c.type]) {
        // The behavior becomes the parent's script, and its settings that
        // script's variables.
        const id = BEHAVIORS[c.type];
        scripts[id] = true;
        if (!e.script) {
          e.script = `scripts/${id}.lua`;
          const settings = c.properties || {};
          for (const k of ['speed', 'acceleration', 'jumpHeight', 'gravity', 'maxFallSpeed', 'airJumps']) {
            if (k in settings) {
              e.properties = e.properties || {};
              e.properties[k] = settings[k];
            }
          }
        }
        continue;
      }
      convert(c);
      kids.push(c);
    }
    if (e.children) e.children = kids;
  };
  if (data?.root) {
    // A 3D scene keeps its pieces' place in the tree as a plain Group.
    if (/3D$/.test(data.root.type || '')) {
      data.root.type = 'Group';
      dropped++;
    }
    convert(data.root);
  }
  data.version = 2;
  return { scripts, dropped };
}
