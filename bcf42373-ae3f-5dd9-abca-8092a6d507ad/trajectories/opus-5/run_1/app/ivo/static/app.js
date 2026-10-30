/* Plain enhancements over the server-rendered pages. */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  var COPY = {
    sending: 'Sending your message…',
    thanks: 'Thanks, your message is in. I reply within two working days.',
    outage: 'Your message could not be sent. Try again in a minute.'
  };

  var FIELD_LABELS = {
    name: 'Name',
    phone: 'Phone',
    email: 'Email',
    message: 'Message',
    project_type: 'Project type'
  };

  function motionOn() {
    return root.dataset.motion === 'on' && !reduced.matches;
  }

  function remember(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      /* Storage is walled off in some browsing modes; the choice is per page. */
    }
  }

  /* ---------------------------------------------------------------- motion */

  function setUpMotionToggle() {
    var button = document.querySelector('[data-motion-button]');
    button.setAttribute('aria-pressed', String(root.dataset.motion === 'on'));
    button.addEventListener('click', function () {
      var next = root.dataset.motion === 'on' ? 'off' : 'on';
      root.dataset.motion = next;
      button.setAttribute('aria-pressed', String(next === 'on'));
      remember('ivo-motion', next);
      revealEverything();
      slideHeroStatement();
    });
  }

  /* -------------------------------------------------------- split headings */

  var splitHeadings = [];

  function buildSplitHeadings() {
    Array.prototype.forEach.call(
      document.querySelectorAll('.split-heading'),
      function (heading) {
        var text = heading.textContent.trim();
        heading.setAttribute('aria-label', text);
        heading.textContent = '';
        text.split(/\s+/).forEach(function (word, index) {
          var span = document.createElement('span');
          span.className = 'split-word';
          span.style.setProperty('--word-index', String(index));
          span.textContent = word;
          heading.appendChild(span);
          heading.appendChild(document.createTextNode(' '));
        });
        heading.dataset.split = 'ready';
        splitHeadings.push(heading);
      }
    );
  }

  function revealEverything() {
    splitHeadings.forEach(function (heading) {
      heading.dataset.revealed = 'true';
    });
  }

  function watchSplitHeadings() {
    if (!motionOn()) {
      revealEverything();
      return;
    }
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.dataset.revealed = 'true';
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '0px 0px -12% 0px' }
    );
    splitHeadings.forEach(function (heading) {
      observer.observe(heading);
    });
  }

  /* --------------------------------------------------- loops while in view */

  function watchChapters() {
    var chapters = document.querySelectorAll('.chapter, .case-detail');
    if (!chapters.length) {
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        entry.target.dataset.inView = String(entry.isIntersecting);
      });
    });
    Array.prototype.forEach.call(chapters, function (chapter) {
      observer.observe(chapter);
    });
  }

  /* ------------------------------------------------- hero statement slide */

  var heroStatement = document.querySelector('[data-hero-statement]');
  var heroChapter = document.getElementById('hero');
  var heroPending = false;

  function slideHeroStatement() {
    if (!heroStatement) {
      return;
    }
    if (!motionOn()) {
      heroStatement.style.transform = '';
      return;
    }
    var height = heroChapter.offsetHeight;
    var bottom = heroChapter.getBoundingClientRect().bottom;
    var progress = Math.min(Math.max((height - bottom) / height, 0), 1);
    var travel = progress * window.innerWidth * 0.25;
    heroStatement.style.transform = 'translate3d(' + -travel + 'px, 0, 0)';
  }

  function watchHeroStatement() {
    if (!heroStatement) {
      return;
    }
    function schedule() {
      if (heroPending) {
        return;
      }
      heroPending = true;
      window.requestAnimationFrame(function () {
        heroPending = false;
        slideHeroStatement();
      });
    }
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    slideHeroStatement();
  }

  /* ------------------------------------------------------------- the menu */

  function setUpMenu() {
    var button = document.querySelector('[data-menu-button]');
    var nav = document.querySelector('[data-main-nav]');

    function close() {
      button.setAttribute('aria-expanded', 'false');
      delete nav.dataset.open;
    }

    button.addEventListener('click', function () {
      var open = button.getAttribute('aria-expanded') === 'true';
      if (open) {
        close();
      } else {
        button.setAttribute('aria-expanded', 'true');
        nav.dataset.open = 'true';
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') {
        close();
        button.focus();
      }
    });
  }

  /* --------------------------------------------------------- inquiry forms */

  var feedback = window.ivoFeedback;

  function fieldControl(form, name) {
    return feedback.control(form, name);
  }

  function collectInquiry(form) {
    var payload = {
      name: fieldControl(form, 'name').value,
      phone: fieldControl(form, 'phone').value,
      email: fieldControl(form, 'email').value,
      message: fieldControl(form, 'message').value
    };
    var projectType = fieldControl(form, 'project_type').value;
    if (projectType) {
      payload.project_type = projectType;
    }
    return payload;
  }

  function acceptInquiry(form) {
    var status = form.querySelector('[data-form-status]');
    form.querySelector('[data-form-fields]').hidden = true;
    status.textContent = COPY.thanks;
    status.focus();
  }

  function setUpInquiryForm(form) {
    var submit = form.querySelector('[data-submit]');
    var status = form.querySelector('[data-form-status]');
    var errors = form.querySelector('[data-form-errors]');

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      feedback.clear(form);
      feedback.reason(errors, '');
      submit.disabled = true;
      status.textContent = COPY.sending;

      window
        .fetch('/api/inquiries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(collectInquiry(form))
        })
        .then(function (response) {
          return response.json().then(function (body) {
            return { status: response.status, body: body };
          });
        })
        .then(function (answer) {
          if (answer.status === 200 || answer.status === 201) {
            acceptInquiry(form);
            return;
          }
          submit.disabled = false;
          status.textContent = '';
          if (answer.status === 422 && answer.body.errors) {
            feedback.fieldMessages(form, answer.body.errors);
            feedback.summary(
              errors,
              form,
              answer.body.errors,
              FIELD_LABELS,
              feedback.FIELD_ERRORS
            );
            return;
          }
          feedback.reason(errors, COPY.outage);
        })
        .catch(function () {
          submit.disabled = false;
          status.textContent = '';
          feedback.reason(errors, COPY.outage);
        });
    });
  }

  function resetInquiryForm(form) {
    form.reset();
    feedback.clear(form);
    feedback.reason(form.querySelector('[data-form-errors]'), '');
    form.querySelector('[data-form-status]').textContent = '';
    form.querySelector('[data-form-fields]').hidden = false;
    form.querySelector('[data-submit]').disabled = false;
  }

  /* -------------------------------------------------------- inquiry dialog */

  function setUpDialog() {
    var layer = document.querySelector('[data-dialog-layer]');
    var panel = document.querySelector('[data-dialog-panel]');
    var opener = document.querySelector('[data-open-dialog]');
    var closer = document.querySelector('[data-close-dialog]');
    var form = panel.querySelector('[data-inquiry-form]');

    function focusable() {
      return Array.prototype.filter.call(
        panel.querySelectorAll('a[href], button, input, select, textarea, [tabindex]'),
        function (node) {
          return !node.disabled && node.tabIndex >= 0 && node.offsetParent !== null;
        }
      );
    }

    function open() {
      resetInquiryForm(form);
      layer.hidden = false;
      fieldControl(form, 'name').focus();
    }

    function close() {
      layer.hidden = true;
      opener.focus();
    }

    opener.addEventListener('click', open);
    closer.addEventListener('click', close);

    panel.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        close();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      var stops = focusable();
      var first = stops[0];
      var last = stops[stops.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  /* ------------------------------------------------------ discipline filter */

  function setUpDisciplineFilter() {
    var nav = document.querySelector('[data-discipline-filter]');
    if (!nav) {
      return;
    }
    var list = document.querySelector('[data-case-list]');
    var status = document.querySelector('[data-catalogue-status]');

    function markCurrent(address) {
      Array.prototype.forEach.call(nav.querySelectorAll('a'), function (link) {
        if (link.getAttribute('href') === address) {
          link.setAttribute('aria-current', 'true');
        } else {
          link.removeAttribute('aria-current');
        }
      });
    }

    function show(address, push) {
      return window
        .fetch(address, { headers: { Accept: 'text/html' } })
        .then(function (response) {
          return response.text();
        })
        .then(function (markup) {
          var fetched = new DOMParser().parseFromString(markup, 'text/html');
          list.innerHTML = fetched.querySelector('[data-case-list]').innerHTML;
          status.textContent = fetched.querySelector(
            '[data-catalogue-status]'
          ).textContent;
          markCurrent(address);
          if (push) {
            window.history.pushState({ address: address }, '', address);
          }
        });
    }

    nav.addEventListener('click', function (event) {
      var link = event.target.closest('a');
      if (!link || event.metaKey || event.ctrlKey || event.shiftKey) {
        return;
      }
      event.preventDefault();
      var address = link.getAttribute('href');
      show(address, true).catch(function () {
        window.location.assign(address);
      });
    });

    window.addEventListener('popstate', function () {
      var address = window.location.pathname + window.location.search;
      show(address, false).catch(function () {
        window.location.reload();
      });
    });
  }

  /* ----------------------------------------------------------------- start */

  buildSplitHeadings();
  watchSplitHeadings();
  watchChapters();
  watchHeroStatement();
  setUpMotionToggle();
  setUpMenu();
  setUpDialog();
  setUpDisciplineFilter();
  Array.prototype.forEach.call(
    document.querySelectorAll('[data-inquiry-form]'),
    setUpInquiryForm
  );
  reduced.addEventListener('change', function () {
    revealEverything();
    slideHeroStatement();
  });
})();
