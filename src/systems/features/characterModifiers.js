/**
 * Attribute modifiers — what equipped items and conditions add to (or take
 * from) a character's attributes, and the effective values that result.
 *
 * Effects are never written into the attributes: the effective value is
 * computed every time (current value + every active effect, kept within
 * 1–100), so unequipping an item or ending a condition removes its bonus by
 * itself. Registers itself with characterStats so the stats prompt can show
 * effective values without characterStats importing equipment/conditions.
 */
import { collectModifiers } from '../../utils/effectsModel.js';
import { equipmentModifierSources } from '../../utils/equipmentModel.js';
import { conditionModifierSources } from '../../utils/conditionModel.js';
import { clampStatValue } from '../../utils/statsModel.js';
import { getStatSheet, getCurrentStatValues, setModifierProvider } from './characterStats.js';
import { getEquipment, isEquipmentEnabled } from './characterEquipment.js';
import { getConditions, isConditionsEnabled } from './characterConditions.js';
import { getAbilities, isAbilitiesEnabled } from './characterAbilities.js';
import { abilityModifierSources } from '../../utils/abilityModel.js';

/**
 * { statId: { total, parts: [{label, value}] } } for the character right now.
 */
export function getAttributeModifiers(name, isUser = false) {
    const sources = [];
    if (isEquipmentEnabled()) sources.push(...equipmentModifierSources(getEquipment(name, isUser)));
    if (isConditionsEnabled()) sources.push(...conditionModifierSources(getConditions(name, isUser)));
    if (isAbilitiesEnabled()) sources.push(...abilityModifierSources(getAbilities(name, isUser)));
    return collectModifiers(sources);
}

/**
 * Current values with attribute modifiers applied.
 * @returns {{ values: Object<string, number>, modifiers: object }}
 */
export function getEffectiveStatValues(name, isUser = false, stats = null) {
    const list = stats || getStatSheet(name, isUser);
    const cur = getCurrentStatValues(name, isUser, list);
    const modifiers = getAttributeModifiers(name, isUser);
    const values = { ...cur };
    for (const s of list) {
        const m = modifiers[s.id];
        if (s.kind !== 'attribute' || !m || !m.total) continue;
        values[s.id] = clampStatValue(s, cur[s.id] + m.total);
    }
    return { values, modifiers };
}

setModifierProvider(getAttributeModifiers);
