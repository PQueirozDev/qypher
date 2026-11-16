export type FindingId = 'csp' | 'tls' | 'env';
export type DemoCommand = 'help' | 'demo' | 'clear' | 'about';
export interface Finding {
  id: FindingId;
  code: string;
  label: string;
  category: string;
  title: string;
  detail: string;
  description: string;
  severity: string;
  state: string;
  recommendation: string;
  angle: number;
  radius: number;
}

// A single fictional scenario is shared by the radar and the guided terminal.
export const findings: readonly Finding[] = [
  {
    id: 'csp',
    code: 'DEMO-001',
    label: 'CSP',
    category: 'HTTP / SECURITY HEADERS',
    title: 'Cabeçalho ausente',
    detail: 'Content-Security-Policy',
    description: 'O projeto fictício não declarou uma política para as origens de conteúdo.',
    severity: 'Moderada',
    state: 'Revisão sugerida',
    recommendation:
      'Exemplo de correção: revisar as origens permitidas na política CSP e validar o comportamento da aplicação.',
    angle: 38,
    radius: 0.58,
  },
  {
    id: 'env',
    code: 'DEMO-002',
    label: '.ENV',
    category: 'EXPOSURE / PROJECT FILES',
    title: 'Arquivo exposto',
    detail: '/.env · sk_••••••••',
    description: 'Um arquivo de configuração aparece acessível neste cenário ilustrativo.',
    severity: 'Alta',
    state: 'Atenção demonstrativa',
    recommendation:
      'Exemplo de correção: remover o arquivo da publicação e revisar as credenciais afetadas.',
    angle: 212,
    radius: 0.72,
  },
  {
    id: 'tls',
    code: 'DEMO-003',
    label: 'TLS',
    category: 'TRANSPORT / CERTIFICATE',
    title: 'Transporte verificado',
    detail: 'TLS / certificado válido',
    description: 'O certificado do domínio reservado atende à verificação fictícia de transporte.',
    severity: 'Informativa',
    state: 'Controle observado',
    recommendation:
      'Exemplo de acompanhamento: manter a renovação do certificado e revisar as configurações de transporte.',
    angle: 258,
    radius: 0.65,
  },
];

export const commands: readonly DemoCommand[] = ['help', 'demo', 'clear', 'about'];
export function parseCommand(value: string): DemoCommand | null {
  const command = value.trim().toLowerCase();
  return commands.includes(command as DemoCommand) ? (command as DemoCommand) : null;
}

/** True only on the frame in which the clockwise scan reaches this angle. */
export function crossesAngle(previous: number, current: number, target: number): boolean {
  if (current <= previous) return false;
  return Math.floor((current - target) / 360) > Math.floor((previous - target) / 360);
}

/** Same projection as the existing CSS rotateX(20deg) rotateZ(-17deg). */
export function markerPosition(angle: number, radius: number, side: number) {
  const theta = (angle * Math.PI) / 180;
  const rotation = (-17 * Math.PI) / 180;
  const reach = (side - 28) * 0.5 * radius;
  const x = Math.sin(theta) * reach;
  const y = -Math.cos(theta) * reach;
  return {
    x: x * Math.cos(rotation) - y * Math.sin(rotation),
    y: (x * Math.sin(rotation) + y * Math.cos(rotation)) * Math.cos((20 * Math.PI) / 180),
  };
}
