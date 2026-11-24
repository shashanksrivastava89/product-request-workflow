import mapping from '../../requesters_mapped.json'

export type SalesRep = {
  id: string;
  code: string;
  name: string;
  salesManager: string;
  districtSalesManager: string;
  nationalSalesManager: string;
  localFinanceController: string;
  directorCommercialManager: string;
  requesterGroupId?: string;  // Link to requester group
}
export type EndUser = {
  code: string;
  name: string;
  postalCode: string;
  prefecture?: string;
  address: string;
  phone: string;
}
export type ChannelPartner = {
  code: string;
  name: string;
  postalCode?: string;
  prefecture?: string;
  address?: string;
  phone?: string;
}

// Requester Groups sourced from JSON
type RequesterGroup = {
  id: string;
  name: string;
  // Allow multi-unit strings like "CDG/LSG"; selection will match on inclusion
  businessUnit?: string;
};

export const requesterGroups: RequesterGroup[] = (mapping.groups || []).map((g: any) => ({
  id: String(g.id),
  name: String(g.name || '').trim(),
  businessUnit: g.businessUnit ? String(g.businessUnit).trim() : undefined,
}))

// Helper function to get requester groups by business unit (supports slash-separated units)
export const getRequesterGroups = (businessUnit?: string): Array<{ id: string, name: string }> => {
  if (!businessUnit) return [];
  return requesterGroups
    .filter(group => {
      if (!group.businessUnit) return false;
      const units = String(group.businessUnit).split('/').map(u => u.trim());
      return units.includes(businessUnit);
    })
    .map(({ id, name }) => ({ id, name }));
};

// Constants for approval roles that are the same for all requesters
export const NATIONAL_SALES_MANAGER = 'Cailum Cortez';
export const LOCAL_FINANCE_CONTROLLER = 'Roberta Miley';
export const DIRECTOR_COMMERCIAL_MANAGER = 'Devon Comyn';

// Sales reps derived from JSON groups and requesters
export const salesReps: SalesRep[] = (mapping.groups || []).flatMap((g: any) => {
  const requesters = Array.isArray(g.requesters) ? g.requesters : []
  return requesters.map((r: any) => ({
    id: String(r.id),
    code: String(r.code ?? '').toLowerCase() === 'nan' ? '' : String(r.code ?? ''),
    name: String(r.name ?? ''),
    salesManager: '',
    districtSalesManager: '',
    nationalSalesManager: NATIONAL_SALES_MANAGER,
    localFinanceController: LOCAL_FINANCE_CONTROLLER,
    directorCommercialManager: DIRECTOR_COMMERCIAL_MANAGER,
    requesterGroupId: String(g.id),
  }))
})

// Keep existing sample end users and partners for now
export const endUsers: EndUser[] = [
  { code: '8000001', name: 'サンプル研究所 第01拠点', postalCode: '000-0001', prefecture: 'Tokyo', address: 'サンプル市架空町1-1-1', phone: '000-0000-0001' },
  { code: '8000002', name: 'サンプル病院 第02検査室', postalCode: '000-0002', prefecture: 'Hokkaido', address: 'サンプル市架空町2-1-1', phone: '000-0000-0002' },
  { code: '8000003', name: 'サンプル病院 第03検査室', postalCode: '000-0003', prefecture: 'Hokkaido', address: 'サンプル市架空町3-1-1', phone: '000-0000-0003' },
  { code: '8000004', name: 'サンプル病院 第04検査室', postalCode: '000-0004', prefecture: 'Hokkaido', address: 'サンプル市架空町4-1-1', phone: '000-0000-0004' },
  { code: '8000005', name: 'サンプル病院 第05検査室', postalCode: '000-0005', prefecture: 'Hokkaido', address: 'サンプル市架空町5-1-1', phone: '000-0000-0005' },
  { code: '8000006', name: 'サンプル病院 第06検査室', postalCode: '000-0006', prefecture: 'Hokkaido', address: 'サンプル市架空町6-1-1', phone: '000-0000-0006' },
  { code: '8000007', name: 'サンプル病院 第07検査室', postalCode: '000-0007', prefecture: 'Hokkaido', address: 'サンプル市架空町7-1-1', phone: '000-0000-0007' },
  { code: '8000008', name: 'サンプル病院 第08検査室', postalCode: '000-0008', prefecture: 'Hokkaido', address: 'サンプル市架空町8-1-1', phone: '000-0000-0008' },
  { code: '8000009', name: 'サンプル病院 第09検査室', postalCode: '000-0009', prefecture: 'Hokkaido', address: 'サンプル市架空町9-1-1', phone: '000-0000-0009' },
  { code: '8000010', name: 'サンプル病院 第10検査室', postalCode: '000-0010', prefecture: 'Hokkaido', address: 'サンプル市架空町10-1-1', phone: '000-0000-0010' },
  { code: '8000011', name: 'サンプル病院 第11検査室', postalCode: '000-0011', prefecture: 'Hokkaido', address: 'サンプル市架空町11-1-1', phone: '000-0000-0011' },
  { code: '8000012', name: 'サンプル病院 第12検査室', postalCode: '000-0012', prefecture: 'Hokkaido', address: 'サンプル市架空町12-1-1', phone: '000-0000-0012' },
  { code: '8000013', name: 'サンプル病院 第13検査室', postalCode: '000-0013', prefecture: 'Hokkaido', address: 'サンプル市架空町13-1-1', phone: '000-0000-0013' },
  { code: '8000014', name: 'サンプル病院 第14検査室', postalCode: '000-0014', prefecture: 'Hokkaido', address: 'サンプル市架空町14-1-1', phone: '000-0000-0014' },
  { code: '8000015', name: 'サンプル病院 第15検査室', postalCode: '000-0015', prefecture: 'Hokkaido', address: 'サンプル市架空町15-1-1', phone: '000-0000-0015' },
  { code: '8000016', name: 'サンプル病院 第16検査室', postalCode: '000-0016', prefecture: 'Hokkaido', address: 'サンプル市架空町16-1-1', phone: '000-0000-0016' },
  { code: '8000017', name: 'サンプル病院 第17検査室', postalCode: '000-0017', prefecture: 'Hokkaido', address: 'サンプル市架空町17-1-1', phone: '000-0000-0017' },
  { code: '8000018', name: 'サンプル病院 第18検査室', postalCode: '000-0018', prefecture: 'Hokkaido', address: 'サンプル市架空町18-1-1', phone: '000-0000-0018' },
  { code: '8000019', name: 'サンプル病院 第19検査室', postalCode: '000-0019', prefecture: 'Hokkaido', address: 'サンプル市架空町19-1-1', phone: '000-0000-0019' },
  { code: '8000020', name: 'サンプル病院 第20検査室', postalCode: '000-0020', prefecture: 'Hokkaido', address: 'サンプル市架空町20-1-1', phone: '000-0000-0020' },
  { code: '8000021', name: 'サンプル病院 第21検査室', postalCode: '000-0021', prefecture: 'Hokkaido', address: 'サンプル市架空町21-1-1', phone: '000-0000-0021' },
  { code: '8000022', name: 'サンプル病院 第22検査室', postalCode: '000-0022', prefecture: 'Hokkaido', address: 'サンプル市架空町22-1-1', phone: '000-0000-0022' },
  { code: '8000023', name: 'サンプル病院 第23検査室', postalCode: '000-0023', prefecture: 'Hokkaido', address: 'サンプル市架空町23-1-1', phone: '000-0000-0023' },
  { code: '8000024', name: 'サンプル病院 第24検査室', postalCode: '000-0024', prefecture: 'Hokkaido', address: 'サンプル市架空町24-1-1', phone: '000-0000-0024' },
  { code: '8000025', name: 'サンプル病院 第25検査室', postalCode: '000-0025', prefecture: 'Hokkaido', address: 'サンプル市架空町25-1-1', phone: '000-0000-0025' }]

export const channelPartners: ChannelPartner[] = [
  { code: '1089602', name: '株式会社サンプル商事 第26物流センター', postalCode: '000-0026', prefecture: 'Akita', address: 'サンプル市架空町26-1-1', phone: '000-0000-0026' },
  { code: '1089603', name: '株式会社サンプル商事 第27物流センター', postalCode: '000-0027', prefecture: 'Oita', address: 'サンプル市架空町27-1-1', phone: '000-0000-0027' },
  { code: '1089604', name: '株式会社サンプル商事 第28物流センター', postalCode: '000-0028', prefecture: 'Fukuoka', address: 'サンプル市架空町28-1-1', phone: '000-0000-0028' },
  { code: '1089605', name: '株式会社サンプル商事 第29物流センター', postalCode: '000-0029', prefecture: 'Fukuoka', address: 'サンプル市架空町29-1-1', phone: '000-0000-0029' },
  { code: '1089606', name: '株式会社サンプル商事 第30物流センター', postalCode: '000-0030', prefecture: 'Okinawa', address: 'サンプル市架空町30-1-1', phone: '000-0000-0030' },
  { code: '1089607', name: '株式会社サンプル商事 第31物流センター', postalCode: '000-0031', prefecture: 'Kagoshima', address: 'サンプル市架空町31-1-1', phone: '000-0000-0031' },
  { code: '1089608', name: '株式会社サンプル商事 第32物流センター', postalCode: '000-0032', prefecture: 'Fukuoka', address: 'サンプル市架空町32-1-1', phone: '000-0000-0032' },
  { code: '1089609', name: '株式会社サンプル商事 第33物流センター', postalCode: '000-0033', prefecture: 'Saga', address: 'サンプル市架空町33-1-1', phone: '000-0000-0033' },
  { code: '1089610', name: '株式会社サンプル商事 第34物流センター', postalCode: '000-0034', prefecture: 'Saga', address: 'サンプル市架空町34-1-1', phone: '000-0000-0034' },
  { code: '1089611', name: '株式会社サンプル商事 第35物流センター', postalCode: '000-0035', prefecture: 'Miyazaki', address: 'サンプル市架空町35-1-1', phone: '000-0000-0035' },
  { code: '1089612', name: '株式会社サンプル商事 第36物流センター', postalCode: '000-0036', prefecture: 'Kumamoto', address: 'サンプル市架空町36-1-1', phone: '000-0000-0036' },
  { code: '1089613', name: '株式会社サンプル商事 第37物流センター', postalCode: '000-0037', prefecture: 'Hiroshima', address: 'サンプル市架空町37-1-1', phone: '000-0000-0037' },
  { code: '1089616', name: '株式会社サンプル商事 第38物流センター', postalCode: '000-0038', prefecture: 'Kyoto', address: 'サンプル市架空町38-1-1', phone: '000-0000-0038' },
  { code: '1089617', name: '株式会社サンプル商事 第39物流センター', postalCode: '000-0039', prefecture: 'Shiga', address: 'サンプル市架空町39-1-1', phone: '000-0000-0039' },
  { code: '1089619', name: '株式会社サンプル商事 第40物流センター', postalCode: '000-0040', prefecture: 'Saitama', address: 'サンプル市架空町40-1-1', phone: '000-0000-0040' },
  { code: '1089620', name: '株式会社サンプル商事 第41物流センター', postalCode: '000-0041', prefecture: 'Aichi', address: 'サンプル市架空町41-1-1', phone: '000-0000-0041' },
  { code: '1089621', name: '株式会社サンプル商事 第42物流センター', postalCode: '000-0042', prefecture: 'Aichi', address: 'サンプル市架空町42-1-1', phone: '000-0000-0042' },
  // Ship-To Data (Service Centers / Direct)
  { code: '2108901', name: 'サンプル病院 第43検査室', postalCode: '000-0043', prefecture: '青森県', address: 'サンプル市架空町43-1-1', phone: '000-0000-0043' },
  { code: '2108902', name: '株式会社サンプル商事 第44物流センター', postalCode: '000-0044', prefecture: '三重県', address: 'サンプル市架空町44-1-1', phone: '000-0000-0044' },
  { code: '2108903', name: 'サンプル病院 第45検査室', postalCode: '000-0045', prefecture: '京都府', address: 'サンプル市架空町45-1-1', phone: '000-0000-0045' },
  { code: '2108904', name: '株式会社サンプル商事 第46物流センター', postalCode: '000-0046', prefecture: '岩手県', address: 'サンプル市架空町46-1-1', phone: '000-0000-0046' },
  { code: '2108905', name: 'サンプル病院 第47検査室', postalCode: '000-0047', prefecture: '岡山県', address: 'サンプル市架空町47-1-1', phone: '000-0000-0047' },
  { code: '2108906', name: 'サンプル病院 第48検査室', postalCode: '000-0048', prefecture: '青森県', address: 'サンプル市架空町48-1-1', phone: '000-0000-0048' },
  { code: '2108907', name: 'サンプル病院 第49検査室', postalCode: '000-0049', prefecture: '北海道', address: 'サンプル市架空町49-1-1', phone: '000-0000-0049' },
  { code: '2108908', name: 'サンプル病院 第50検査室', postalCode: '000-0050', prefecture: '北海道', address: 'サンプル市架空町50-1-1', phone: '000-0000-0050' },
  { code: '2108909', name: '株式会社サンプル商事 第51物流センター', postalCode: '000-0051', prefecture: '北海道', address: 'サンプル市架空町51-1-1', phone: '000-0000-0051' },
  { code: '2108910', name: 'サンプル病院 第52検査室', postalCode: '000-0052', prefecture: '北海道', address: 'サンプル市架空町52-1-1', phone: '000-0000-0052' },
  { code: '2108911', name: '株式会社サンプル商事 第53物流センター', postalCode: '000-0053', prefecture: '北海道', address: 'サンプル市架空町53-1-1', phone: '000-0000-0053' },
  { code: '2108912', name: 'サンプル病院 第54検査室', postalCode: '000-0054', prefecture: '北海道', address: 'サンプル市架空町54-1-1', phone: '000-0000-0054' },
  { code: '2108913', name: '株式会社サンプル商事 第55物流センター', postalCode: '000-0055', prefecture: '北海道', address: 'サンプル市架空町55-1-1', phone: '000-0000-0055' },
  { code: '2108914', name: 'サンプル病院 第56検査室', postalCode: '000-0056', prefecture: '北海道', address: 'サンプル市架空町56-1-1', phone: '000-0000-0056' },
  { code: '2108915', name: 'サンプル病院 第57検査室', postalCode: '000-0057', prefecture: '北海道', address: 'サンプル市架空町57-1-1', phone: '000-0000-0057' },
  { code: '2108916', name: 'サンプル病院 第58検査室', postalCode: '000-0058', prefecture: '北海道', address: 'サンプル市架空町58-1-1', phone: '000-0000-0058' },
  { code: '2108917', name: 'サンプル病院 第59検査室', postalCode: '000-0059', prefecture: '福島県', address: 'サンプル市架空町59-1-1', phone: '000-0000-0059' },
  { code: '2108918', name: 'サンプル病院 第60検査室', postalCode: '000-0060', prefecture: '埼玉県', address: 'サンプル市架空町60-1-1', phone: '000-0000-0060' },
  { code: '2108919', name: 'サンプル病院 第61検査室', postalCode: '000-0061', prefecture: '埼玉県', address: 'サンプル市架空町61-1-1', phone: '000-0000-0061' },
  { code: '2108920', name: 'サンプル病院 第62検査室', postalCode: '000-0062', prefecture: '東京都', address: 'サンプル市架空町62-1-1', phone: '000-0000-0062' },
  { code: '2108921', name: 'サンプル病院 第63検査室', postalCode: '000-0063', prefecture: '茨城県', address: 'サンプル市架空町63-1-1', phone: '000-0000-0063' },
]
