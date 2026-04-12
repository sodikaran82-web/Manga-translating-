import React, { useEffect, useRef } from 'react';

interface AdSenseProps {
  adSlot: string;
  adFormat?: 'auto' | 'fluid' | 'rectangle' | 'horizontal' | 'vertical';
  fullWidthResponsive?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export const AdSense: React.FC<AdSenseProps> = ({
  adSlot,
  adFormat = 'auto',
  fullWidthResponsive = true,
  className = '',
  style = { display: 'block' }
}) => {
  const adRef = useRef<HTMLModElement>(null);
  const clientId = import.meta.env.VITE_ADSENSE_CLIENT_ID || 'ca-pub-7292158270704128';

  useEffect(() => {
    // Only push if the ad hasn't been initialized yet and we have a client ID
    if (clientId && adRef.current && !adRef.current.getAttribute('data-adsbygoogle-status')) {
      try {
        // @ts-ignore
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch (err) {
        console.error('AdSense error:', err);
      }
    }
  }, [clientId, adSlot]);

  if (!clientId) {
    // In development or if no ID is provided, show a placeholder
    return (
      <div className={`bg-gray-100 border border-dashed border-gray-300 rounded-lg flex items-center justify-center text-gray-400 text-sm p-4 ${className}`} style={style}>
        AdSense Placeholder (Add VITE_ADSENSE_CLIENT_ID to .env)
      </div>
    );
  }

  return (
    <div className={`overflow-hidden ${className}`}>
      <ins
        ref={adRef}
        className="adsbygoogle"
        style={style}
        data-ad-client={clientId}
        data-ad-slot={adSlot}
        data-ad-format={adFormat}
        data-full-width-responsive={fullWidthResponsive ? 'true' : 'false'}
      />
    </div>
  );
};

