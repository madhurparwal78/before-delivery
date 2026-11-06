/* The studio sign-in page: holds the owner's token for this tab only. */
(function () {
  'use strict';

  var feedback = window.ivoFeedback;
  var form = document.querySelector('[data-sign-in-form]');
  var submit = form.querySelector('[data-submit]');
  var errors = form.querySelector('[data-form-errors]');
  var LABELS = { email: 'Email', password: 'Password' };
  var OUTAGE = 'Sign-in is unavailable. Try again in a minute.';

  function settle() {
    submit.disabled = false;
    submit.textContent = 'Sign in';
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    feedback.clear(form);
    feedback.reason(errors, '');
    submit.disabled = true;
    submit.textContent = 'Signing in…';

    window
      .fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: feedback.control(form, 'email').value,
          password: feedback.control(form, 'password').value
        })
      })
      .then(function (response) {
        return response.json().then(function (body) {
          return { status: response.status, body: body };
        });
      })
      .then(function (answer) {
        if (answer.status === 200) {
          window.sessionStorage.setItem('ivo-studio-token', answer.body.token);
          window.location.assign('/studio');
          return;
        }
        settle();
        if (answer.status === 422 && answer.body.errors) {
          feedback.fieldMessages(form, answer.body.errors);
          feedback.summary(
            errors,
            form,
            answer.body.errors,
            LABELS,
            feedback.FIELD_ERRORS
          );
          return;
        }
        if (answer.status === 503) {
          feedback.reason(errors, OUTAGE);
          return;
        }
        feedback.reason(errors, answer.body.error);
      })
      .catch(function () {
        settle();
        feedback.reason(errors, OUTAGE);
      });
  });
})();
