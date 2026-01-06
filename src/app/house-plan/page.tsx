'use client';

import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState, Suspense } from 'react';
import LZString from 'lz-string';
import { KaokuzuData } from '@/lib/kaokuzu-types';

// Import Editor with SSR disabled to avoid Canvas hydration issues
const HousePlanEditor = dynamic(() => import('@/components/HousePlanEditor'), {
    ssr: false,
    loading: () => <div className="flex items-center justify-center h-screen">Loading Editor...</div>
});

export default function HousePlanPage() {
    return (
        <Suspense fallback={<div>Loading Page...</div>}>
            <HousePlanContent />
        </Suspense>
    );
}

function HousePlanContent() {
    const searchParams = useSearchParams();
    const [data, setData] = useState<KaokuzuData | undefined>(undefined);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const dataParam = searchParams?.get('data');
        if (dataParam) {
            try {
                const decompressed = LZString.decompressFromEncodedURIComponent(dataParam);
                if (decompressed) {
                    const parsed = JSON.parse(decompressed);
                    // Basic validation or migration could go here
                    setData(parsed);
                }
            } catch (e) {
                console.error("Failed to parse house plan data", e);
            }
        }
        setLoading(false);
    }, [searchParams]);

    if (loading) return <div>Loading...</div>;

    return <HousePlanEditor initialData={data} />;
}
