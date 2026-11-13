/** A procedural harbour town at night: stepped quay, lit houses, a lighthouse and black water with orange reflections. */
export function Harbour({ label }: { label: string }) {
  const houses = Array.from({ length: 14 }, (_, i) => {
    const w = 70 + ((i * 37) % 40)
    const h = 90 + ((i * 53) % 110)
    const x = 20 + i * 84
    return { x, w, h, lit: [0, 1, 2, 3].map((k) => (i * 7 + k * 5) % 3 !== 0) }
  })
  return (
    <svg className="harbour" role="img" aria-label={label} viewBox="0 0 1200 520" preserveAspectRatio="xMidYMid slice">
      <rect width="1200" height="520" fill="#000" />
      <circle cx="980" cy="90" r="46" fill="#E4FF1A" />
      {Array.from({ length: 36 }, (_, i) => <rect key={i} x={(i * 97) % 1180} y={(i * 41) % 170 + 14} width="3" height="3" fill="#F7F7F2" />)}
      <rect x="1040" y="170" width="46" height="170" fill="#F7F7F2" />
      <polygon points="1030,170 1096,170 1063,128" fill="#F25C05" />
      <rect x="1052" y="196" width="22" height="22" fill="#E4FF1A" />
      {houses.map((house, i) => (
        <g key={i}>
          <rect x={house.x} y={350 - house.h} width={house.w} height={house.h} fill={i % 3 === 0 ? '#CDE3C8' : '#F2F2F2'} />
          <polygon points={`${house.x - 4},${350 - house.h} ${house.x + house.w / 2},${322 - house.h} ${house.x + house.w + 4},${350 - house.h}`} fill="#F25C05" />
          {house.lit.map((lit, k) => <rect key={k} x={house.x + 12 + (k % 2) * 28} y={350 - house.h + 18 + Math.floor(k / 2) * 34} width="14" height="20" fill={lit ? '#E4FF1A' : '#000'} />)}
        </g>
      ))}
      <rect y="350" width="1200" height="16" fill="#F7F7F2" />
      <rect y="366" width="1200" height="154" fill="#000" />
      {Array.from({ length: 18 }, (_, i) => <rect key={i} x={30 + i * 66} y={380 + (i % 4) * 28} width={26 + (i % 3) * 14} height="5" fill={i % 2 ? '#F25C05' : '#E4FF1A'} />)}
      <polygon points="180,430 330,430 306,466 206,466" fill="#F7F7F2" />
      <rect x="252" y="372" width="5" height="58" fill="#F7F7F2" />
      <polygon points="258,374 258,426 310,426" fill="#F25C05" />
    </svg>
  )
}
