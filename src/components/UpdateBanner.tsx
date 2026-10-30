import { useEffect, useState } from 'react';
import { checkForUpdate, markAppReady, restartIntoUpdate, type UpdateState } from '../updater';
import { RELEASE_PAGE } from '../version';

const CHECK_EVERY = 60 * 60 * 1000;

export function UpdateBanner() {
  const [state, setState] = useState<UpdateState>({ kind: 'none' });

  useEffect(() => {
    markAppReady();
    let busy = false;
    const run = async () => {
      if (busy) return;
      busy = true;
      await checkForUpdate(setState);
      busy = false;
    };
    run();
    const t = setInterval(run, CHECK_EVERY);
    return () => clearInterval(t);
  }, []);

  if (state.kind === 'none') return null;
  return (
    <div className="update-banner">
      {state.kind === 'downloading' && <span>Загружается обновление…</span>}
      {state.kind === 'ready' && (
        <>
          <span>Обновление готово</span>
          <button className="btn primary small-btn" onClick={() => restartIntoUpdate()}>
            Перезапустить
          </button>
        </>
      )}
      {state.kind === 'reinstall' && (
        <>
          <span>Вышла новая версия, её нужно установить заново</span>
          <a className="btn primary small-btn" href={RELEASE_PAGE} target="_blank" rel="noreferrer noopener">
            Скачать
          </a>
        </>
      )}
    </div>
  );
}
