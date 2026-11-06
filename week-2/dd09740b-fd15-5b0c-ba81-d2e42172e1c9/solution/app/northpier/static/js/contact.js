// Contact offices: live local greetings, updated on each new minute of the browser clock.
const OFFICES = {
  stockholm: (hour, minute) => {
    const hello = hour < 12 ? 'God morgon' : hour < 18 ? 'God eftermiddag' : 'God kväll';
    return `${hello}, klockan är ${String(hour).padStart(2, '0')}:${minute}`;
  },
  reykjavik: (hour, minute) => {
    const hello = hour < 12 ? 'Góðan daginn' : hour < 18 ? 'Góðan dag' : 'Gott kvöld';
    return `${hello}, klukkan er ${hour % 12 || 12}:${minute} ${hour < 12 ? 'AM' : 'PM'}`;
  },
};
const ZONES = { stockholm: 'Europe/Stockholm', reykjavik: 'Atlantic/Reykjavik' };

function localTime(zone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date());
  const value = (type) => parts.find((part) => part.type === type).value;
  return [Number(value('hour')), value('minute')];
}

function paint() {
  for (const element of document.querySelectorAll('.greeting[data-office]')) {
    const office = element.dataset.office;
    element.textContent = OFFICES[office](...localTime(ZONES[office]));
  }
}

function everyMinute() {
  paint();
  setTimeout(everyMinute, 60000 - (Date.now() % 60000));
}

everyMinute();
