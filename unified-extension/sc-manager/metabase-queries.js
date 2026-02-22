/**
 * metabase-queries.js - Metabase API Query Definitions
 * 
 * Contains all query configurations for SC Manager dashboard metrics
 */

const METABASE_QUERIES = {
  
  // 1. IB Pendency - Inbound shipments pending at facility
  IB_PENDENCY: {
    id: 167151,
    name: 'IB Pendency',
    endpoint: 'https://metabase-main.bi.meeshogcp.in/api/card/167151/query',
    refreshInterval: 60000, // 1 minute
    columns: [
      'dest_location', 'next_facility', 'current_movement_type', 'source_location',
      'current_facility', 'in_tat_volume', 'in_tat_SC_volume', 'in_tat_CD_volume',
      'tat_breach_volume', 'tat_breach_SC_volume', 'tat_breach_CD_volume',
      'tat_breach_6_hrs_volume', 'tat_breach_12_hrs_volume', 'tat_breach_24_hrs_volume',
      'tat_breach_48_hrs_volume', 'tat_breach_5_day_volume', 'tat_breach_10_day_volume'
    ],
    displayColumns: [
      { key: 'source_location', label: 'Source' },
      { key: 'current_facility', label: 'Current Facility' },
      { key: 'dest_location', label: 'Destination' },
      { key: 'in_tat_volume', label: 'In TAT' },
      { key: 'tat_breach_volume', label: 'Breach' },
      { key: 'tat_breach_24_hrs_volume', label: '24h+ Breach' },
      { key: 'tat_breach_48_hrs_volume', label: '48h+ Breach' }
    ]
  },

  // 2. OB Pendency - Outbound shipments pending at facility
  OB_PENDENCY: {
    id: 167481,
    name: 'OB Pendency',
    endpoint: 'https://metabase-main.bi.meeshogcp.in/api/card/167481/query',
    refreshInterval: 60000,
    params: {
      facility: 'dgs7', // Default, can be overridden
      min_aging_hours: 72,
      movement_type: 'forward'
    },
    displayColumns: [
      { key: 'facility', label: 'Facility' },
      { key: 'shipment_id', label: 'Shipment ID' },
      { key: 'aging_hours', label: 'Aging (hrs)' },
      { key: 'destination', label: 'Destination' },
      { key: 'movement_type', label: 'Type' }
    ]
  },

  // 3. Shortage Visibility - Marked vs Assigned shortages
  SHORTAGE: {
    id: null, // Superset, not Metabase
    name: 'Shortage Visibility',
    endpoint: 'https://di-prd-superset.meesho.com/superset/explore/p/dZo9M37QBQ7/',
    type: 'superset',
    refreshInterval: 120000, // 2 minutes
    categories: [
      { type: 'marked_short', label: 'Marked Short', subcategories: ['Shipment', 'Bag', 'Challan'] },
      { type: 'assigned_short', label: 'Assigned Short', subcategories: ['Shipment', 'Bag', 'Challan'] }
    ]
  },

  // 4. In-Transit - Trip-level tracking data
  IN_TRANSIT: {
    id: 170895,
    name: 'In-Transit (IB & OB)',
    endpoint: 'https://metabase-main.bi.meeshogcp.in/api/card/170895/query',
    refreshInterval: 90000, // 1.5 minutes
    displayColumns: [
      { key: 'source', label: 'Source' },
      { key: 'destination', label: 'Destination' },
      { key: 'trip_id', label: 'Trip ID' },
      { key: 'challan_id', label: 'Challan ID' },
      { key: 'dispatch_time', label: 'Dispatch Time' },
      { key: 'received_time', label: 'Received Time' },
      { key: 'trip_status', label: 'Status' },
      { key: 'vehicle_number', label: 'Vehicle' },
      { key: 'driver_number', label: 'Driver' },
      { key: 'tat_hours', label: 'TAT (hrs)' }
    ]
  },

  // 5. Lane Volume - FMSC to LMSC volume breakdown
  LANE_VOLUME: {
    id: 121307,
    name: 'Lane-wise Volume',
    endpoint: 'https://metabase-main.bi.meeshogcp.in/api/card/121307/query',
    refreshInterval: 300000, // 5 minutes
    params: {
      manifest_type: '11am-11am',
      week: 'month',
      aggregate_2: 'lmsc',
      aggregate_1: 'fmsc',
      start_date: null, // Set dynamically
      end_date: null
    },
    displayColumns: [
      { key: 'fmsc', label: 'FMSC' },
      { key: 'lmsc', label: 'LMSC' },
      { key: 'lane', label: 'Lane' },
      { key: 'volume', label: 'Volume' },
      { key: 'zone', label: 'Zone' }
    ]
  },

  // 6. Shipment Path Tracking - Journey visualization
  SHIPMENT_TRACKING: {
    id: null, // Custom implementation
    name: 'Shipment Path Tracking',
    type: 'custom',
    description: 'Complete shipment journey path visibility'
  },

  // 7. Multi-Site Access - Not a query, but a filter toggle
  MULTI_SITE: {
    type: 'filter',
    name: 'Multi-Site Access',
    description: 'Download reports for multiple sites simultaneously'
  },

  // 8. Bag-Level Visibility - Bag details at gateways
  BAG_VISIBILITY: {
    id: null, // To be defined
    name: 'Bag-Level Visibility',
    endpoint: null, // Need query from SC team
    refreshInterval: 90000,
    displayColumns: [
      { key: 'bag_id', label: 'Bag ID' },
      { key: 'shipment_count', label: 'Shipments' },
      { key: 'source', label: 'Source' },
      { key: 'destination', label: 'Destination' },
      { key: 'aging_hours', label: 'Aging (hrs)' }
    ]
  }
};


/**
 * Helper: Fetch data from Metabase query
 */
async function fetchMetabaseQuery(queryConfig, params = {}) {
  try {
    const response = await fetch(queryConfig.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({
        parameters: params
      })
    });

    if (!response.ok) {
      throw new Error(`Metabase API error: ${response.status}`);
    }

    const data = await response.json();
    
    return {
      success: true,
      rows: data.data?.rows || [],
      columns: data.data?.cols || [],
      timestamp: Date.now()
    };

  } catch (err) {
    console.error(`[Metabase] Failed to fetch ${queryConfig.name}:`, err);
    return {
      success: false,
      error: err.message,
      timestamp: Date.now()
    };
  }
}


/**
 * Helper: Format timestamp for display
 */
function formatLastUpdated(timestamp) {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins === 1) return '1 min ago';
  if (diffMins < 60) return `${diffMins} mins ago`;
  
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours === 1) return '1 hour ago';
  return `${diffHours} hours ago`;
}


// Export for use in other modules
window.METABASE_QUERIES = METABASE_QUERIES;
window.fetchMetabaseQuery = fetchMetabaseQuery;
window.formatLastUpdated = formatLastUpdated;