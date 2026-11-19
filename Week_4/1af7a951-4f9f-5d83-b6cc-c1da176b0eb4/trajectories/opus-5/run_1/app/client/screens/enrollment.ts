import { api, type Enrollment } from '../api.js';
import { COPY, dollars } from '../copy.js';
import { clear, h, setHidden, setText } from '../dom.js';
import { alertRegion, announce, statusRegion } from '../live.js';
import { navigate } from '../main.js';

export function enrollmentScreen(enrollmentId: string): Node {
  const accessCode = sessionStorage.getItem('lf.access_code');
  sessionStorage.removeItem('lf.access_code');

  const heading = h('h1', { text: COPY.paymentPending });
  const codeGroup = h('div', { role: 'group', 'aria-label': 'Access code', hidden: true });
  const status = statusRegion('Enrollment');
  const payment = alertRegion('Payment');
  const pay = h('button', { type: 'button', class: 'primary', hidden: true });
  const openLogbook = h('button', {
    type: 'button',
    class: 'primary',
    text: COPY.openLogbook,
    hidden: true,
  });
  openLogbook.addEventListener('click', () => {
    navigate('/logbook');
  });

  const screen = h('section', { class: 'screen narrow stack' }, [
    heading,
    codeGroup,
    pay,
    openLogbook,
    status,
    payment,
  ]);

  function showEnrolled(): void {
    setText(heading, COPY.enrolled);
    setHidden(pay, true);
    setHidden(codeGroup, true);
    setHidden(openLogbook, false);
  }

  function showPending(enrollment: Enrollment): void {
    setText(heading, COPY.paymentPending);
    pay.textContent = `Pay ${dollars(enrollment.price_cents)}`;
    pay.setAttribute('aria-label', `Pay ${dollars(enrollment.price_cents)}`);
    setHidden(pay, false);
    setHidden(openLogbook, true);
  }

  function paidLines(enrollment: Enrollment): void {
    clear(status);
    status.append(
      h('p', { text: `A receipt is on its way to ${enrollment.email}.` }),
      h('p', {
        text: `Your first night: ${enrollment.first_night ?? ''} \u2013 bedtime ${enrollment.bedtime}, wake alarm ${enrollment.wake_alarm}.`,
      }),
    );
  }

  void (async () => {
    const result = await api.enrollment(enrollmentId);
    if (!result.ok || result.body === null) {
      clear(screen);
      screen.append(h('h1', { text: 'Page not found' }), h('p', { text: COPY.pageNotFound }));
      return;
    }
    let enrollment = result.body.enrollment;
    if (accessCode !== null && enrollment.status === 'pending_payment') {
      codeGroup.append(h('p', { text: `Your access code: ${accessCode}` }));
      setHidden(codeGroup, false);
    }
    if (enrollment.status === 'active') {
      showEnrolled();
      paidLines(enrollment);
    } else {
      showPending(enrollment);
      announce(status, COPY.seatNotReserved);
    }

    pay.addEventListener('click', () => {
      void (async () => {
        pay.disabled = true;
        announce(payment, '');
        announce(status, COPY.confirmingPayment);
        const paid = await api.pay(enrollment.id);
        pay.disabled = false;
        if (paid.ok && paid.body !== null) {
          enrollment = paid.body.enrollment;
          showEnrolled();
          paidLines(enrollment);
          return;
        }
        if (paid.status === 503) {
          announce(payment, COPY.billingOutage);
          announce(status, COPY.seatNotReserved);
          return;
        }
        if (paid.errorCode === 'payment_declined') announce(status, COPY.paymentDeclined);
        else if (paid.errorCode === 'cohort_full') announce(status, COPY.cohortFull);
        else announce(status, COPY.seatNotReserved);
      })();
    });
  })();

  return screen;
}
