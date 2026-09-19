(function(){
  var emailBtn = document.getElementById('emailBtn');
  var emailToast = document.getElementById('emailToast');
  if(emailBtn && emailToast){
    emailBtn.addEventListener('click', function(){
      var address = 'wilson.cyriaco@imperiumservicos.com';
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(address).catch(function(){});
      }
      emailToast.classList.add('show');
      clearTimeout(emailBtn._toastTimer);
      emailBtn._toastTimer = setTimeout(function(){
        emailToast.classList.remove('show');
      }, 3500);
    });
  }
})();
(function(){
  var track = document.getElementById('carouselTrack');
  var carousel = document.getElementById('carousel');
  var dotsWrap = document.getElementById('carouselDots');
  var prevBtn = document.getElementById('carouselPrev');
  var nextBtn = document.getElementById('carouselNext');
  var progressBar = document.getElementById('carouselProgressBar');
  if(!track || !carousel) return;

  // A partir daqui sabemos que o JavaScript está rodando: liga as
  // animações de entrada (definidas em CSS sob .js-carousel). Sem isso,
  // o conteúdo permanece estático porém sempre visível (ver CSS).
  carousel.classList.add('js-carousel');

  var slides = Array.prototype.slice.call(track.children);
  var index = 0;
  var AUTOPLAY_MS = 5000;
  var rafId = null;
  var segmentStart = null;
  var pausedElapsed = 0;
  var isPaused = false;

  // As bolinhas já existem no HTML (uma por slide, a primeira com
  // "active") para que apareçam mesmo se o JS demorar ou falhar. Aqui
  // só reaproveitamos esses elementos; só criamos novos se faltar algum
  // (por exemplo, se o número de slides mudar no futuro).
  var dots = Array.prototype.slice.call(dotsWrap.children);
  while(dots.length < slides.length){
    var dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'carousel-dot';
    dot.setAttribute('aria-label', 'Ir para serviço ' + (dots.length + 1));
    dotsWrap.appendChild(dot);
    dots.push(dot);
  }
  dots.forEach(function(dot, i){
    dot.setAttribute('aria-label', 'Ir para serviço ' + (i + 1));
    dot.addEventListener('click', function(){ goTo(i, true); });
  });

  function setActiveSlide(){
    slides.forEach(function(s, i){ s.classList.toggle('is-active', i === index); });
  }

  function restartIconAnimation(){
    // remove e reaplica a classe para reiniciar a animação de entrada do ícone/texto
    var active = slides[index];
    active.classList.remove('is-active');
    void active.offsetWidth; // força reflow
    active.classList.add('is-active');
  }

  function update(){
    track.style.transform = 'translateX(' + (-index * 100) + '%)';
    dots.forEach(function(d, i){ d.classList.toggle('active', i === index); });
    setActiveSlide();
    setTimeout(restartIconAnimation, 30);
  }

  function goTo(i, userAction){
    index = (i + slides.length) % slides.length;
    update();
    if(userAction) restartAutoplay();
  }

  // Motor único (requestAnimationFrame) que controla tanto o avanço automático
  // quanto a barra de progresso, evitando que os dois fiquem dessincronizados
  // (o que fazia um slide eventualmente "travar" sem avançar sozinho).
  function tick(timestamp){
    rafId = requestAnimationFrame(tick);
    if(isPaused){ segmentStart = null; return; }
    if(segmentStart === null){ segmentStart = timestamp; }
    var elapsed = timestamp - segmentStart;
    var pct = Math.min(elapsed / AUTOPLAY_MS, 1);
    progressBar.style.width = (pct * 100) + '%';
    if(elapsed >= AUTOPLAY_MS){
      goTo(index + 1);
      segmentStart = timestamp;
    }
  }

  function startAutoplay(){
    isPaused = false;
    segmentStart = null;
    carousel.classList.remove('is-paused');
    if(rafId === null){ rafId = requestAnimationFrame(tick); }
  }
  function stopAutoplay(){
    isPaused = true;
    carousel.classList.add('is-paused');
  }
  function restartAutoplay(){ startAutoplay(); }

  nextBtn.addEventListener('click', function(){ goTo(index + 1, true); });
  prevBtn.addEventListener('click', function(){ goTo(index - 1, true); });

  carousel.addEventListener('mouseenter', stopAutoplay);
  carousel.addEventListener('mouseleave', startAutoplay);
  carousel.addEventListener('focusin', stopAutoplay);
  carousel.addEventListener('focusout', startAutoplay);

  // arraste / swipe no toque
  var touchStartX = null;
  track.addEventListener('touchstart', function(e){
    touchStartX = e.touches[0].clientX;
    stopAutoplay();
  }, {passive:true});
  track.addEventListener('touchend', function(e){
    if(touchStartX === null) return;
    var diff = e.changedTouches[0].clientX - touchStartX;
    if(Math.abs(diff) > 40){
      goTo(index + (diff < 0 ? 1 : -1), true);
    } else {
      startAutoplay();
    }
    touchStartX = null;
  });

  // navegação por teclado
  carousel.setAttribute('tabindex', '0');
  carousel.addEventListener('keydown', function(e){
    if(e.key === 'ArrowRight'){ goTo(index + 1, true); }
    if(e.key === 'ArrowLeft'){ goTo(index - 1, true); }
  });

  update();
  startAutoplay();
})();

(function(){
  // Clicar na logo do cabeçalho leva de volta ao topo da página.
  var brand = document.getElementById('brandLogo');
  if(!brand) return;

  function goTop(){
    window.scrollTo({ top:0, behavior:'smooth' });
  }

  brand.addEventListener('click', goTop);
  brand.addEventListener('keydown', function(e){
    if(e.key === 'Enter' || e.key === ' '){
      e.preventDefault();
      goTop();
    }
  });
})();

(function(){
  // Revelação ao rolar a página. A classe .js-reveal só é adicionada aqui;
  // sem JavaScript os elementos .reveal/.reveal-rule permanecem sempre
  // visíveis (ver CSS), então o conteúdo nunca fica escondido por engano.
  document.documentElement.classList.add('js-reveal');

  var items = Array.prototype.slice.call(document.querySelectorAll('.reveal, .reveal-rule'));
  if(!items.length) return;

  if(!('IntersectionObserver' in window)){
    items.forEach(function(el){ el.classList.add('is-visible'); });
    return;
  }

  // Alterna is-visible nos dois sentidos (sem unobserve): o elemento
  // reaparece ao entrar na tela e volta a se esconder ao sair, para poder
  // ser revelado de novo da próxima vez.
  var observer = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      entry.target.classList.toggle('is-visible', entry.isIntersecting);
    });
  }, { threshold:0.15, rootMargin:'0px 0px -40px 0px' });

  items.forEach(function(el){ observer.observe(el); });
})();

(function(){
  // Cabeçalho compacto ao rolar e botão "voltar ao topo". Cada peça é
  // opcional: se um elemento não existir no HTML, essa parte simplesmente
  // não faz nada.
  var header = document.querySelector('header');
  var backToTop = document.getElementById('backToTop');
  if(!header && !backToTop) return;

  var ticking = false;

  function update(){
    var scrollTop = window.pageYOffset || document.documentElement.scrollTop;

    if(header){ header.classList.toggle('scrolled', scrollTop > 40); }
    if(backToTop){ backToTop.classList.toggle('show', scrollTop > 520); }
    ticking = false;
  }

  function onScroll(){
    if(!ticking){
      requestAnimationFrame(update);
      ticking = true;
    }
  }

  window.addEventListener('scroll', onScroll, {passive:true});
  update();

  if(backToTop){
    backToTop.addEventListener('click', function(){
      window.scrollTo({ top:0, behavior:'smooth' });
    });
  }
})();
