# Atualização de propostas: 3x por semana e valor fixo por pessoa

Este pacote contém exatamente os três arquivos públicos da alteração:
- `index.html`
- `sw.js`
- `js/modules/propostas.js`

Origem: commit `602ce6669dace3cc96dfbec06d38022d5e7025ec`.
Arquivo: `imperium-propostas-3x-pessoas.zip` (1668556 bytes).
Integridade conferida por CRC e comparação dos conteúdos dos três arquivos com o código publicado.
Os 14 cenários do módulo real foram executados em V8, incluindo cálculo, preferências, eventos de edição, HTML da prévia e XML do Word.

## Publicar na Hostinger

1. No hPanel, abra o **Gerenciador de arquivos** do domínio `imperiumservicos.com`.
2. Entre em `public_html/app`. É a pasta da plataforma no subdomínio `app.imperiumservicos.com`.
3. Faça uma cópia dos três arquivos existentes indicados acima para permitir a restauração.
4. Envie o ZIP para `public_html/app` e extraia **nessa mesma pasta**, permitindo a substituição dos arquivos. Se o extrator solicitar uma pasta, use a pasta atual (na interface anterior do gerenciador, o nome `.` representa essa pasta). O `index.html` do ZIP deve ficar diretamente em `public_html/app/index.html`.
5. Atualize a plataforma com **Ctrl+F5**. No aplicativo instalado, feche e abra novamente com internet.
6. Depois da extração, mova apenas o ZIP enviado para a lixeira do gerenciador de arquivos.

## Conferir

Abra **Propostas** e selecione um cargo. Informe:
- Valor fixo do posto / pessoa: **R$ 2.500,00**
- Pessoas (total): **4**
- Postos: **2**
- Escala: **3x por semana**

O total desse serviço deve ser **R$ 10.000,00 por mês**. O resumo do editor, a prévia/PDF, o Word e o aceite usam o mesmo cálculo. Para a escala de 3x por semana, informe o preço mensal acordado.

As versões do pacote são `propostas.js?v=27` e cache `imperium-v52`.
A conferência visual no site publicado depende da conclusão do envio à Hostinger.
