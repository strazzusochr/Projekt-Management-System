import type { PuzzleDefinition } from '../../puzzle/types';

/**
 * LEVEL 2 – The Sunken Temple: guardians and mischievous chaos spirits
 * (same mathematics as the documented missionaries/cannibals family, original fantasy framing:
 * outnumbered guardians get tricked by illusions and lose the temple seals).
 */
const guardian = (id: string, name: string, flavor: string) => ({
  id,
  name,
  kind: 'guardian',
  role: 'guardian',
  canPilot: true,
  trait: 'Wächter · kann die Lotosbarke lenken · darf nicht in Unterzahl geraten',
  flavor,
});
const chaos = (id: string, name: string, flavor: string) => ({
  id,
  name,
  kind: 'chaos',
  role: 'chaos',
  canPilot: true,
  trait: 'Chaoswesen · kann die Lotosbarke lenken · wird in der Überzahl übermütig',
  flavor,
});

export const templePuzzle: PuzzleDefinition = {
  id: 'temple',
  entities: [
    guardian('guardian1', 'Arun', 'Hüter der Sonnensiegel, ruhig wie Stein.'),
    guardian('guardian2', 'Sela', 'Trägt die Laterne des ersten Tempels.'),
    guardian('guardian3', 'Kiran', 'Jüngster Wächter, schnell mit dem Stab.'),
    chaos('chaos1', 'Zikk', 'Kichert in Echos und stiehlt glänzende Dinge.'),
    chaos('chaos2', 'Mok', 'Verdreht Pfade mit Trugbildern.'),
    chaos('chaos3', 'Pell', 'Tanzt auf Wasser, wenn keiner hinsieht.'),
  ],
  rules: [
    {
      id: 'outnumber',
      type: 'noOutnumber',
      protectedGroup: { role: 'guardian' },
      threatGroup: { role: 'chaos' },
      scope: 'banks',
      title: 'Die Chaoswesen sind in der Überzahl',
      summary: 'Wo Wächter stehen, dürfen die Chaoswesen nicht in der Überzahl sein.',
      icon: 'scales',
      message:
        'Diese Konstellation ist nicht zulässig: {loc} stünden {threatCount} Chaoswesen nur {protectedCount} Wächter gegenüber – sie würden die Wächter mit Trugbildern überlisten und die Tempelsiegel stehlen.',
    },
  ],
  vehicle: { capacity: 2, requirePilot: true },
  roleLabels: {
    guardian: { one: 'ein Wächter', many: '{n} Wächter' },
    chaos: { one: 'ein Chaoswesen', many: '{n} Chaoswesen' },
  },
  cost: { type: 'crossings' },
  sides: [
    { name: 'Ruinenkai', at: 'am Ruinenkai', to: 'zum Ruinenkai' },
    { name: 'Heiligtum', at: 'im Heiligtum', to: 'zum Heiligtum' },
  ],
  vehicleNames: {
    name: 'Lotosbarke',
    at: 'in der Lotosbarke',
    into: 'in die Lotosbarke',
    nom: 'die Lotosbarke',
    acc: 'die Lotosbarke',
    from: 'aus der Lotosbarke',
  },
};
