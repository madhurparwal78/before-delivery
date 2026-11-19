// Fernhollow Tea, the bundled sample (invented data). The text is the brief's seed data, byte for byte.

export const ORDERS_CSV = [
  'Order,Date,Stockist ID,Product,Category,Units,Sales\n',
  '1,2027-01-04,S1,Moss Sencha,Green,4,120\n',
  '2,2027-01-06,S1,Ember Assam,Black,2,50\n',
  '3,2027-01-11,S2,Moss Sencha,Green,3,90\n',
  '4,2027-01-13,S3,Quiet Mint,Herbal,5,75\n',
  '5,2027-01-20,S3,Ember Assam,Black,6,150\n',
  '6,2027-02-02,S4,Quiet Mint,Herbal,2,30\n',
  '7,2027-02-03,S4,Moss Sencha,Green,1,30\n',
  '8,2027-02-09,S5,Ember Assam,Black,8,200\n',
  '9,2027-02-10,S5,Dusk Blend,Black,4,80\n',
  '10,2027-02-17,S1,Dusk Blend,Black,5,100\n',
  '11,2027-02-24,S2,Quiet Mint,Herbal,6,90\n',
  '12,2027-03-01,S3,Moss Sencha,Green,7,210\n',
  '13,2027-03-03,S5,Quiet Mint,Herbal,3,45\n',
  '14,2027-03-08,S1,Quiet Mint,Herbal,2,30\n',
  '15,2027-03-15,S9,Dusk Blend,Black,1,20\n',
  '16,2027-03-16,S4,Ember Assam,Black,,\n',
].join('');

export const STOCKISTS_CSV = [
  'Stockist ID,Stockist,Region,Tier,Target\n',
  'S1,Alder Cup,North,Gold,900\n',
  'S2,Birch Kettle,North,Silver,500\n',
  'S3,Cedar Pot,East,Gold,700\n',
  'S4,Dune Mug,South,Silver,400\n',
  'S5,Elm Leaf,West,Gold,600\n',
].join('');

/** How the sample loads: its tables in order, the join, the drill hierarchy and the number fields made dimensions. */
export const SAMPLE_TABLES = [
  { name: 'orders', csv: ORDERS_CSV },
  { name: 'stockists', csv: STOCKISTS_CSV },
] as const;

export const SAMPLE_RELATION = {
  left_table: 'orders',
  left_key: 'Stockist ID',
  right_table: 'stockists',
  right_key: 'Stockist ID',
} as const;

export const SAMPLE_HIERARCHY = { name: 'Geography', fields: ['Region', 'Stockist'] } as const;

export const SAMPLE_DIMENSIONS = ['Order'] as const;
