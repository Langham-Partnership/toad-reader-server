async function copyLink(link) {
  try {
    await navigator.clipboard.writeText(link);
  } catch {
    var copyEl = document.createElement('input');
    copyEl.className = 'copyel';
    copyEl.value = link;
    document.body.appendChild(copyEl);
    copyEl.select();
    copyEl.focus();
    document.execCommand('copy');
    copyEl.remove();
  }
  var notice = document.querySelector('.copy-url-copied');
  notice.classList.add('show');
  setTimeout(function () {
    notice.classList.remove('show');
  }, 600);
}

document.addEventListener('DOMContentLoaded', function () {
  var btn = document.querySelector('.copy-url');
  if (btn) {
    btn.addEventListener('click', function () {
      copyLink(this.dataset.url);
    });
  }
});
