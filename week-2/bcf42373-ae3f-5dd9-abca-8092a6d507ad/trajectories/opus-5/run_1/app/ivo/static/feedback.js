/* Field marks and error summaries, shared by every form on the site. */
window.ivoFeedback = (function () {
  'use strict';

  var FIELD_ERRORS = 'Check the highlighted fields.';

  function control(form, name) {
    return form.querySelector('[name="' + name + '"]');
  }

  /* Clears the field marks only; a form's summary region is cleared by its
     owner, because the studio keeps one summary outside the editor form. */
  function clear(form) {
    Array.prototype.forEach.call(
      form.querySelectorAll('[data-field-message]'),
      function (slot) {
        slot.textContent = '';
      }
    );
    Array.prototype.forEach.call(form.querySelectorAll('[name]'), function (node) {
      node.removeAttribute('aria-invalid');
    });
  }

  function fieldMessages(form, messages) {
    Object.keys(messages).forEach(function (name) {
      var slot = form.querySelector('[data-field-message="' + name + '"]');
      var node = control(form, name);
      if (slot) {
        slot.textContent = messages[name];
      }
      if (node) {
        node.setAttribute('aria-invalid', 'true');
      }
    });
  }

  function summary(region, form, messages, labels, heading) {
    region.textContent = '';
    var line = document.createElement('p');
    line.textContent = heading;
    region.appendChild(line);
    var list = document.createElement('ul');
    Object.keys(messages).forEach(function (name) {
      var node = control(form, name);
      var item = document.createElement('li');
      var link = document.createElement('a');
      link.href = node ? '#' + node.id : '#';
      link.textContent = labels[name] || name;
      if (node) {
        link.addEventListener('click', function (event) {
          event.preventDefault();
          node.focus();
        });
      }
      item.appendChild(link);
      list.appendChild(item);
    });
    region.appendChild(list);
  }

  function reason(region, message) {
    region.textContent = message;
  }

  return {
    FIELD_ERRORS: FIELD_ERRORS,
    control: control,
    clear: clear,
    fieldMessages: fieldMessages,
    summary: summary,
    reason: reason
  };
})();
