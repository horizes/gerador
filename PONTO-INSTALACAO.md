# Imperium Ponto — homologação

O módulo entregue é um piloto funcional integrado à plataforma. **Não é um REP-P regularizado e não substitui o sistema oficial atual.** O CNPJ informado foi preenchido como 62.249.653/0001-66. A razão social precisa ser confirmada. O modo oficial é bloqueado por uma restrição no banco; não há botão para liberá-lo.

## Instalação

1. Faça backup do banco e instale primeiro em um projeto Supabase de testes. Não migre batidas oficiais para o piloto.
2. Execute `supabase-schema-ponto.sql` depois de todos os scripts da plataforma, inclusive cargos unificados e melhorias. Execute uma vez; a migração é transacional.
3. Publique o HTML, CSS, JS, imagens, manifesto e service worker. Não publique os scripts SQL e os documentos internos no site.
4. Na tela Usuários, atribua **Meu ponto** aos colaboradores e **Gestão de ponto** aos gestores autorizados. Os administradores já acessam ambos pelo modelo existente. Nenhum cargo recebe acesso automaticamente.
O site precisa ser servido por HTTPS (ou localhost em testes). Usuários com histórico de ponto devem ser inativados; as referências de histórico impedem apagar suas contas.

5. Em Gestão de ponto, cadastre nome, CPF, matrícula, escala, horários e convenção de cada colaborador. O CPF é validado pelo banco. As escalas 5×2, 6×1 e 12×36 foram encontradas nas propostas; não são, sozinhas, prova de jornada contratual ou de convenção aplicável.
6. Teste a batida, download do registro de teste, pedido de inclusão/desconsideração e decisão por outro gestor. Teste contas sem acesso e contas com acesso apenas ao próprio ponto.

## Controles implementados

- Horário recebido do banco, sem confiar no relógio enviado pelo navegador. Relógio da tela sincronizado com o servidor.
- Batidas sem bloqueio por escala, quantidade, localização ou hora. Não são coletadas fotos, biometria nem localização.
- Reenvio com o mesmo UUID devolve o registro anterior; uma nova ação confirmada gera nova batida. Em falha de comunicação não aparece confirmação falsa nem é criada batida offline.
- Originais, solicitações, decisões e auditoria sem UPDATE/DELETE, inclusive por clientes com papel service_role. Apenas RPCs autorizadas escrevem. Um proprietário do banco ainda pode remover os controles: estes não equivalem a armazenamento WORM certificado.
- Cópias de identificação no original, vínculos com FK restritiva para não apagar histórico ao excluir a conta e cadeia SHA-256 interna. O número interno e o hash do piloto **não são NSR/hash regulamentares do AFD**.
- Inclusões e desconsiderações justificadas em separado. Gestor não aprova sua própria solicitação. Decisões únicas e dupla aprovação para a mesma desconsideração impedida.
- RLS protege leitura por colaborador ou gestor, além da filtragem de módulos no navegador. Dados pessoais não ficam em localStorage.
- Histórico paginado, consulta por período, registros tratados e exportação JSON interna. Pedidos e decisões são carregados integralmente para preservar o tratamento, inclusive decisões posteriores ao período.

## O que falta antes do uso oficial

A ausência de registro no INPI e certificado ICP-Brasil informada pela empresa impede concluir a implantação oficial. Não altere o CHECK para contornar essa etapa.

Além desses documentos, esta entrega ainda **não implementa**: ARP/NSR e eventos completos por estabelecimento no leiaute oficial, AFD 004, AEJ 002, comprovantes PDF assinados PAdES, assinaturas CAdES destacadas dos arquivos, espelho regulamentar, monitoramento comprovado da Hora Legal Brasileira, redundância/continuidade e política de retenção verificadas. Estes itens exigem uma próxima etapa técnica; não basta fornecer o certificado para este piloto virar REP-P.

Para essa etapa, precisam ser definidos e validados: razão social e estabelecimentos; responsável desenvolvedor e titulares dos certificados; registro do programa no INPI; serviço de assinatura e guarda segura da chave; sincronização com a Hora Legal Brasileira e resposta a falhas; arquitetura com armazenamento íntegro, redundante e backups restauráveis; atestado técnico e termo de responsabilidade assinado pelas pessoas competentes; versões oficiais vigentes dos leiautes; comprovante disponibilizado a cada marcação e consulta às últimas 48 horas; fiscalizações e acesso aos arquivos; retenção, LGPD e acesso aos dados por ex-colaboradores.

As regras de intervalos, turnos noturnos, tolerâncias, feriados, compensação, 12×36, adicionais e banco de horas dependem dos contratos, regime e instrumentos coletivos aplicáveis. O piloto não calcula folha nem presume uma convenção a partir de uma proposta comercial.

## Fontes oficiais

- [MTE: registradores eletrônicos de ponto e documentos vigentes](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/rep)
- [MTE: perguntas e respostas sobre REP](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/Perguntas%20e%20Respostas%20REP)
- [Leiaute AFD](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/leiaute-do-arquivo-fonte-de-dados-afd.pdf)
- [Leiaute AEJ](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/leiaute-do-arquivo-eletronico-de-jornada-aej.pdf)

## Validação desta entrega

Foram executados testes locais de JavaScript, preservação dos registros durante tratamento, navegação e interface com servidor simulado. A migração SQL não foi executada em um PostgreSQL real neste ambiente. Não houve acesso de administração ao Supabase da empresa nem implantação no site publicado. Não há certificação de conformidade ou assinatura qualificada nesta entrega.
