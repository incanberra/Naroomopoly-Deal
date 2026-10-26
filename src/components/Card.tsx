import { card, SETS } from '../game/catalogue';
import { CoastArt } from './CoastArt';
export function CardFace({
  id,
  small = false,
  onClick,
  selected = false,
}: {
  id: string;
  small?: boolean;
  onClick?: () => void;
  selected?: boolean;
}) {
  const c = card(id);
  const content = (
    <>
      <div
        className="card-top"
        style={{ background: c.colors?.length === 1 ? SETS[c.colors[0]].color : undefined }}
      >
        <span>
          {c.kind === 'wild'
            ? '↔'
            : c.kind === 'money'
              ? '$'
              : c.kind === 'property'
                ? '⌂'
                : c.effect === 'no'
                  ? '✋'
                  : '✦'}
        </span>
        <b>{c.value}M</b>
      </div>
      {c.kind === 'property' || c.kind === 'wild' ? (
        <CoastArt variant={Number(id.slice(1))} className="card-art" />
      ) : (
        <div className={`card-symbol ${c.kind === 'money' ? 'money-symbol' : ''}`}>
          {c.kind === 'money' ? (
            <>
              {c.value}
              <small>M</small>
            </>
          ) : c.effect === 'no' ? (
            '✋'
          ) : c.effect === 'house' ? (
            '⌂'
          ) : c.effect === 'hotel' ? (
            '▥'
          ) : c.effect === 'takeSet' ? (
            '♛'
          ) : c.effect === 'draw2' ? (
            '☀'
          ) : c.effect === 'rent' ? (
            '≈'
          ) : (
            '✦'
          )}
        </div>
      )}
      <div className="card-copy">
        <span className="eyebrow">
          {c.motif === 'knowledge'
            ? 'Local Knowledge'
            : c.motif === 'notice'
              ? 'Community Notice Board'
              : c.kind === 'money'
                ? 'Coastal currency'
                : 'South Coast collection'}
        </span>
        <strong>{c.name}</strong>
        <small>{c.subtitle}</small>
        {!small && <p>{c.description}</p>}
      </div>
      {c.colors && (
        <div className="color-stripe">
          {c.colors.map((color) => (
            <i key={color} style={{ background: SETS[color].color }} />
          ))}
        </div>
      )}
    </>
  );
  return onClick ? (
    <button
      type="button"
      aria-label={`Inspect ${c.name}`}
      aria-pressed={selected}
      className={`game-card ${small ? 'compact' : ''} ${selected ? 'selected' : ''}`}
      onClick={onClick}
    >
      {content}
    </button>
  ) : (
    <div className={`game-card ${small ? 'compact' : ''}`}>{content}</div>
  );
}
