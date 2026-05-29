'use client';

function SkeletonLine({ w = 'w-full', h = 'h-3' }: { w?: string; h?: string }) {
  return <div className={`${w} ${h} bg-gray-200 rounded animate-pulse`} />;
}

export function SkeletonPartnerRow() {
  return (
    <tr className="border-b border-gray-100">
      <td className="px-4 py-3 w-5"><div className="w-2 h-2 rounded-full bg-gray-200 animate-pulse" /></td>
      <td className="px-4 py-3">
        <SkeletonLine w="w-40" h="h-3.5" />
        <SkeletonLine w="w-28" h="h-2.5" />
      </td>
      <td className="px-4 py-3 hidden md:table-cell"><SkeletonLine w="w-32" h="h-3" /></td>
      <td className="px-4 py-3 hidden lg:table-cell"><SkeletonLine w="w-20" h="h-5" /></td>
      <td className="px-4 py-3 hidden lg:table-cell">
        <div className="flex gap-1">
          <SkeletonLine w="w-14" h="h-5" />
          <SkeletonLine w="w-14" h="h-5" />
        </div>
      </td>
      <td className="px-4 py-3 hidden xl:table-cell"><SkeletonLine w="w-24" h="h-3" /></td>
      <td className="px-4 py-3"><SkeletonLine w="w-16" h="h-5" /></td>
    </tr>
  );
}

export function SkeletonDetailPage() {
  return (
    <div className="px-6 py-6 max-w-6xl mx-auto space-y-4 animate-pulse">
      <div className="h-3 w-32 bg-gray-200 rounded" />
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 bg-gray-200 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-5 w-48 bg-gray-200 rounded" />
            <div className="h-3 w-64 bg-gray-200 rounded" />
            <div className="h-3 w-32 bg-gray-200 rounded" />
          </div>
        </div>
        <div className="flex gap-2 mt-4 pt-3 border-t border-gray-100">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-7 w-28 bg-gray-200 rounded-lg" />
          ))}
        </div>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
        <div className="h-3 w-20 bg-gray-200 rounded" />
        {[1, 2, 3].map(i => (
          <div key={i} className="flex gap-3">
            <div className="w-10 h-10 bg-gray-200 rounded-full shrink-0" />
            <div className="flex-1 bg-gray-50 rounded-lg p-3 space-y-2">
              <div className="h-2.5 w-full bg-gray-200 rounded" />
              <div className="h-2.5 w-3/4 bg-gray-200 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonKanban() {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2 animate-pulse">
      {[1, 2, 3, 4, 5].map(col => (
        <div key={col} className="flex-shrink-0 w-64 border border-gray-200 rounded-xl overflow-hidden">
          <div className="bg-gray-50 px-3 py-2.5 border-b border-gray-200">
            <div className="h-3 w-20 bg-gray-200 rounded" />
          </div>
          <div className="p-2 space-y-2">
            {[1, 2].map(card => (
              <div key={card} className="bg-white border border-gray-200 rounded-xl p-3 space-y-2">
                <div className="flex gap-2">
                  <div className="w-8 h-8 bg-gray-200 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-full bg-gray-200 rounded" />
                    <div className="h-2.5 w-2/3 bg-gray-200 rounded" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="animate-pulse p-4 space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLine key={i} w={i === 0 ? 'w-3/4' : i % 2 === 0 ? 'w-full' : 'w-5/6'} />
      ))}
    </div>
  );
}
