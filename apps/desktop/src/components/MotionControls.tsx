import { useState } from 'react';
import {
  bootSplashEnabled,
  readMotionPreference,
  saveBootSplash,
  saveMotionPreference,
  type MotionPreference,
} from '../appearance';
export function MotionControls() {
  const [motion, setMotion] = useState<MotionPreference>(readMotionPreference);
  const [boot, setBoot] = useState(bootSplashEnabled);
  const [systemReduces] = useState(
    () =>
      typeof window !== 'undefined' &&
      !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  );
  return (
    <>
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
        {systemReduces && motion === 'system' && (
          <small className="motion-hint" role="note">
            Seu sistema está pedindo menos movimento (no Windows: Configurações › Acessibilidade ›
            Efeitos visuais › Efeitos de animação). Por isso o app mostra só transições suaves e a
            abertura em versão calma. Escolha “Ativadas” para ver todas as animações.
          </small>
        )}
      </label>
      <label className="motion-preference boot-preference">
        <span>
          <input
            type="checkbox"
            checked={boot}
            disabled={motion === 'off'}
            onChange={(event) => {
              setBoot(event.target.checked);
              saveBootSplash(event.target.checked);
            }}
          />{' '}
          Animação de abertura do aplicativo
        </span>
        <small>Exibida uma vez ao abrir o Qypher. Clique ou Esc para pular.</small>
      </label>
    </>
  );
}
