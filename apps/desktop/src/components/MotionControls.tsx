import { useState } from 'react';
import { readMotionPreference, saveMotionPreference, type MotionPreference } from '../appearance';
export function MotionControls() {
  const [motion, setMotion] = useState<MotionPreference>(readMotionPreference);
  return (
    <label className="motion-preference">
      Animações da interface
      <select
        value={motion}
        onChange={(event) => {
          const value = event.target.value as MotionPreference;
          setMotion(value);
          saveMotionPreference(value);
        }}
      >
        <option value="system">Respeitar preferência do sistema</option>
        <option value="on">Ativadas</option>
        <option value="off">Desativadas</option>
      </select>
      <small>
        O código animado é decorativo. Eventos e resultados do motor nunca são simulados.
      </small>
    </label>
  );
}
