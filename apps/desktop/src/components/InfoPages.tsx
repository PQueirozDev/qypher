import { useState } from 'react';
import { Accessibility, Check, Code2, Database, LockKeyhole, ShieldCheck } from 'lucide-react';
import { PageTitle, Panel } from './ui';
import { MotionControls } from './MotionControls';
import { APP_VERSION, startInTerminal, setStartInTerminal } from '../startup';

function StartupControl() {
  const [on, setOn] = useState(() => startInTerminal());
  return (
    <div className="padded">
      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            setOn(e.target.checked);
            setStartInTerminal(e.target.checked);
          }}
          style={{ marginTop: 3 }}
        />
        <span>
          <b>Iniciar no modo terminal</b>
          <br />
          <span className="muted-text">
            Ao abrir, o Qypher mostra apenas o terminal em tela cheia. Use o comando{' '}
            <code>unlock</code> para revelar a interface gráfica. A mudança vale na próxima
            inicialização.
          </span>
        </span>
      </label>
    </div>
  );
}
export function AccessibilityPage() {
  return (
    <>
      <PageTitle
        tag="MÓDULO INDEPENDENTE / ACESSIBILIDADE"
        title="Módulo de acessibilidade"
        description="A análise de acessibilidade é independente da classificação de segurança."
      />
      <Panel title="axe-core / WCAG 2.2" meta={<span className="badge">Planejado</span>}>
        <div className="feature-explainer">
          <div className="summary-icon">
            <Accessibility size={36} />
          </div>
          <h2>Automação com limites claros.</h2>
          <p>
            Este MVP ainda não executa um navegador isolado ou o axe-core. Nenhum resultado de
            contraste, semântica ou ARIA é apresentado como analisado.
          </p>
          <div className="roadmap-grid">
            {[
              'Contraste e nomes acessíveis',
              'Imagens e textos alternativos',
              'Labels, landmarks e headings',
              'ARIA e navegação por teclado',
            ].map((l) => (
              <div key={l}>
                <Check size={15} />
                {l}
              </div>
            ))}
          </div>
          <div className="notice">
            <ShieldCheck size={20} />
            <p>
              Testes automatizados cobrem apenas parte da WCAG. Revisão manual, leitor de tela e
              testes com pessoas continuam necessários.
            </p>
          </div>
        </div>
      </Panel>
    </>
  );
}
export function Settings() {
  return (
    <>
      <PageTitle
        tag="APLICATIVO / CONFIGURAÇÃO"
        title="Configuração / política de segurança"
        description="As políticas de segurança deste MVP são aplicadas no motor, inclusive fora da interface."
      />
      <div className="settings-grid">
        {[
          {
            icon: Database,
            title: 'Persistência',
            text: 'SQLite no diretório de dados do usuário, com migrations e histórico local. Sem criptografia de banco nesta versão; proteja a conta e o disco.',
          },
          {
            icon: LockKeyhole,
            title: 'Credenciais & privacidade',
            text: 'Evidências sanitizadas; segredos completos não são exibidos ou exportados. Credenciais de contas fictícias no laboratório são usadas somente na execução e não integram o histórico. Sem telemetria.',
          },
          {
            icon: ShieldCheck,
            title: 'Política de rede',
            text: 'Uma execução por vez, com escopo explícito, orçamento, timeout e cancelamento. Quick Scan e Deep Scan informam seus limites antes de iniciar. O laboratório exige contas e recursos fictícios.',
          },
          {
            icon: Code2,
            title: 'Integrações externas',
            text: 'ZAP, Playwright e axe-core não estão integrados ao scanner. Nenhum executável é instalado ou iniciado silenciosamente.',
          },
        ].map(({ icon: Icon, title, text }) => (
          <Panel key={title} title={title} meta={<Icon size={18} />}>
            <p className="padded settings-copy">{text}</p>
          </Panel>
        ))}
      </div>
      <Panel title="Inicialização">
        <StartupControl />
      </Panel>
      <Panel title="Aparência e movimento">
        <div className="padded">
          <MotionControls />
        </div>
      </Panel>
      <Panel title="Acessibilidade da interface">
        <div className="padded">
          <p>
            Atalhos nativos de teclado, foco visível e semântica HTML. A preferência “reduzir
            movimento” do sistema é respeitada automaticamente.
          </p>
          <p className="muted-text">
            Para excluir dados, use Projects ou Scan history. Relatórios exportados são arquivos
            independentes e precisam ser removidos separadamente.
          </p>
        </div>
      </Panel>
    </>
  );
}
export function About() {
  return (
    <>
      <PageTitle
        tag="CÓDIGO ABERTO / SOBRE"
        title="Qypher / sobre esta versão"
        description="De vibe coders, para vibe coders."
      />
      <Panel
        title={`Qypher ${APP_VERSION}`}
        meta={<span className="badge status-completed">MVP</span>}
      >
        <div className="feature-explainer">
          <div className="brand about-brand">
            <ShieldCheck />
            <span>
              Qypher<span className="brand-dot">.</span>
            </span>
          </div>
          <h2>Você cria com IA. O Qypher ajuda a proteger.</h2>
          <p>
            Uma ferramenta local para vibe coders, desenvolvedores independentes, estudantes e
            criadores de SaaS entenderem evidências e corrigirem seus próprios projetos.
          </p>
          <p>
            Desktop com Tauri 2, motor Rust, React/TypeScript e SQLite. Licença Apache-2.0. Sem APIs
            pagas e sem servidor externo para as funcionalidades principais.
          </p>
          <p>
            O motor reúne observações HTTP/TLS, análise local de código e testes controlados com
            dados fictícios. A evidência e a cobertura determinam o que pode ser concluído; a
            análise não substitui revisão manual e não atribui CVSS automaticamente.
          </p>
          <p className="muted-text">
            Documentação: docs/ARCHITECTURE.md, docs/DEVELOPMENT.md e docs/ROADMAP.md no
            repositório. Para divulgar uma falha do próprio Qypher, consulte SECURITY.md.
          </p>
          <div className="privacy-line">
            <LockKeyhole size={14} /> LOCAL-FIRST · AUTHORIZED ONLY · OPEN SOURCE
          </div>
        </div>
      </Panel>
    </>
  );
}
