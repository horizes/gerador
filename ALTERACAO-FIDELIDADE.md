# Fidelidade no gerador de propostas

Em **Gerador de propostas → Diferenciais e condições**, use a chave **Exigir fidelidade contratual**:

- **Ligada:** a proposta inclui **Fidelidade Contratual**.
- **Desligada:** a proposta inclui **Flexibilidade Contratual**, sem fidelidade ou prazo mínimo.

O título e a descrição de cada opção são editáveis e mantidos separadamente ao alternar a chave. O texto inicial de fidelidade deixa o prazo e as condições de rescisão para serem acordados entre as partes; edite a descrição para informar os termos da proposta.

A condição selecionada aparece na pré-visualização, na impressão, no PDF e no Word. Ao usar **Definir configurações atuais como padrão**, a escolha e os dois textos ficam salvos no padrão da conta e são reaplicados em novas propostas.

O padrão inicial continua sem fidelidade. Nos padrões anteriores, o diferencial identificado como **Flexibilidade Contratual** é transferido para a opção correspondente, preservando a descrição editada.

## Atualização

Publique os arquivos da pasta `imperium-plataforma` deste ZIP na hospedagem da plataforma. Os arquivos alterados são:

- `js/modules/propostas.js`
- `css/propostas.css`
- `index.html`
- `sw.js`

Esta alteração utiliza a configuração JSON do padrão de propostas existente e não exige um novo script SQL. As versões dos arquivos e do cache foram atualizadas para carregar a nova interface após a publicação.
