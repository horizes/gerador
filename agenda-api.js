/* Ponte exclusiva da agenda. Mantém o cliente Supabase já usado pela plataforma. */
(function(){'use strict';
async function call(action,payload={}){
 const {data,error}=await window.Imperium.supabase.functions.invoke('agenda',{body:{action,payload}});
 let failure=data?.error;
 if(error){try{failure=(await error.context.json()).error;}catch{failure={code:'NETWORK',message:'Não foi possível confirmar a resposta do servidor.'};}}
 if(failure){const e=new Error(failure.message||'Não foi possível concluir a operação.');e.code=failure.code||'NETWORK';throw e;}
 if(!data||!Object.hasOwn(data,'data')){const e=new Error('Não foi possível confirmar a resposta do servidor.');e.code='NETWORK';throw e;}
 return data.data;
}
window.ImperiumAgendaAPI={call};
})();
