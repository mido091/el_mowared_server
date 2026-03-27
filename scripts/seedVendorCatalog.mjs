import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config({ path: './.env' });

const TARGET_VENDOR_EMAIL = 'midomohamed0914@gmail.com';
const DEFAULT_LOCATION = 'Cairo, Egypt';

const categoryTemplates = [
  {
    order: 0,
    products: [
      {
        nameEn: 'Smart Factory PLC Controller',
        nameAr: 'وحدة تحكم PLC للمصانع الذكية',
        descriptionEn: 'Industrial PLC controller designed for continuous automation environments, with stable I/O handling, remote diagnostics support, and easy integration with production lines in medium and large facilities.',
        descriptionAr: 'وحدة تحكم صناعية PLC مخصصة لبيئات الأتمتة المستمرة، وتوفر معالجة مستقرة للمدخلات والمخرجات، ودعمًا للتشخيص عن بُعد، وسهولة في الدمج مع خطوط الإنتاج داخل المصانع المتوسطة والكبيرة.',
        price: 18500,
        discountPrice: 17250,
        minOrderQuantity: 1,
        quantityAvailable: 24,
        specs: [
          { key: 'Processor', value: 'Dual-core industrial CPU' },
          { key: 'I/O Points', value: '48 configurable digital/analog points' },
          { key: 'Communication', value: 'Ethernet, Modbus TCP, RS485' },
          { key: 'Protection', value: 'IP20 industrial enclosure' }
        ]
      },
      {
        nameEn: 'Industrial HMI Touch Panel',
        nameAr: 'شاشة تشغيل صناعية HMI',
        descriptionEn: 'A rugged HMI panel for machine monitoring and operator control, offering clear visuals, responsive touch navigation, and dependable performance for daily industrial workflows.',
        descriptionAr: 'شاشة تشغيل صناعية قوية لمراقبة الماكينات والتحكم التشغيلي، وتوفر عرضًا واضحًا، واستجابة سريعة للمس، وأداءً يعتمد عليه في سير العمل الصناعي اليومي.',
        price: 9600,
        discountPrice: 8950,
        minOrderQuantity: 1,
        quantityAvailable: 31,
        specs: [
          { key: 'Display Size', value: '10.1 inch IPS panel' },
          { key: 'Touch Type', value: 'Capacitive multi-touch' },
          { key: 'Mounting', value: 'Panel mount' },
          { key: 'Temperature Range', value: '-10C to 60C' }
        ]
      },
      {
        nameEn: 'Variable Frequency Drive 11kW',
        nameAr: 'انفرتر تحكم في السرعة 11 كيلووات',
        descriptionEn: 'Energy-efficient variable frequency drive suitable for pumps, fans, and conveyor applications, helping factories optimize motor control and reduce operational energy costs.',
        descriptionAr: 'جهاز تحكم في السرعة موفر للطاقة ومناسب للمضخات والمراوح والسيور الناقلة، ويساعد المصانع على تحسين التحكم في المحركات وتقليل تكلفة استهلاك الطاقة التشغيلية.',
        price: 14200,
        discountPrice: 13100,
        minOrderQuantity: 1,
        quantityAvailable: 18,
        specs: [
          { key: 'Power Rating', value: '11kW / 15HP' },
          { key: 'Input Voltage', value: '380-480V AC' },
          { key: 'Control Mode', value: 'Vector and V/F control' },
          { key: 'Efficiency', value: 'Up to 98%' }
        ]
      },
      {
        nameEn: 'Industrial Temperature Sensor Suite',
        nameAr: 'مجموعة حساسات حرارة صناعية',
        descriptionEn: 'A calibrated sensor bundle for process temperature monitoring across workshops, control cabinets, and manufacturing equipment requiring precise and stable readings.',
        descriptionAr: 'حزمة حساسات معايرة لمراقبة درجات الحرارة في الورش ولوحات التحكم والمعدات الصناعية التي تحتاج إلى قراءات دقيقة ومستقرة على مدار التشغيل.',
        price: 3800,
        discountPrice: 3490,
        minOrderQuantity: 5,
        quantityAvailable: 120,
        specs: [
          { key: 'Sensor Type', value: 'PT100 / thermocouple compatible' },
          { key: 'Cable Length', value: '2 meters shielded cable' },
          { key: 'Accuracy', value: '+/-0.3C' },
          { key: 'Housing', value: 'Stainless steel probe' }
        ]
      },
      {
        nameEn: 'Modular IO Expansion Unit',
        nameAr: 'وحدة توسعة مداخل ومخارج صناعية',
        descriptionEn: 'Expandable industrial I/O module that helps plants scale automation points quickly while maintaining communication stability with the main control cabinet.',
        descriptionAr: 'وحدة توسعة للمداخل والمخارج تساعد المصانع على زيادة نقاط الأتمتة بسرعة، مع الحفاظ على استقرار الاتصال مع لوحة التحكم الرئيسية.',
        price: 6250,
        discountPrice: 5890,
        minOrderQuantity: 2,
        quantityAvailable: 42,
        specs: [
          { key: 'Channels', value: '32 mixed input/output channels' },
          { key: 'Protocol', value: 'Modbus RTU and TCP' },
          { key: 'Installation', value: 'DIN rail' },
          { key: 'Diagnostics', value: 'LED status indicators' }
        ]
      }
    ]
  },
  {
    order: 1,
    products: [
      {
        nameEn: 'Online UPS 10kVA',
        nameAr: 'وحدة UPS أونلاين 10 ك.ف.أ',
        descriptionEn: 'Reliable online UPS built for mission-critical loads such as network racks, control rooms, and server cabinets that cannot tolerate voltage fluctuations or power interruptions.',
        descriptionAr: 'وحدة طاقة غير منقطعة أونلاين موثوقة للأحمال الحرجة مثل رفوف الشبكات وغرف التحكم وخزائن الخوادم التي لا تتحمل تقلبات الجهد أو انقطاع الكهرباء.',
        price: 42750,
        discountPrice: 39900,
        minOrderQuantity: 1,
        quantityAvailable: 12,
        specs: [
          { key: 'Capacity', value: '10kVA / 9kW' },
          { key: 'Topology', value: 'True online double conversion' },
          { key: 'Battery Support', value: 'External battery bank ready' },
          { key: 'Bypass', value: 'Automatic and manual bypass' }
        ]
      },
      {
        nameEn: 'Lithium Rack Battery Pack',
        nameAr: 'بطارية ليثيوم للرفوف',
        descriptionEn: 'Compact lithium battery module for UPS and telecom rooms, delivering longer lifecycle performance, high discharge stability, and simplified maintenance compared to traditional batteries.',
        descriptionAr: 'وحدة بطارية ليثيوم مدمجة لغرف الاتصالات وأنظمة UPS، وتوفر عمر تشغيل أطول، واستقرارًا عاليًا في التفريغ، وصيانة أسهل من البطاريات التقليدية.',
        price: 21900,
        discountPrice: 20500,
        minOrderQuantity: 1,
        quantityAvailable: 27,
        specs: [
          { key: 'Chemistry', value: 'LiFePO4' },
          { key: 'Nominal Voltage', value: '51.2V' },
          { key: 'Capacity', value: '100Ah' },
          { key: 'Monitoring', value: 'Integrated BMS with alarms' }
        ]
      },
      {
        nameEn: 'Solar Hybrid Inverter 8kW',
        nameAr: 'انفرتر هجين للطاقة الشمسية 8 كيلووات',
        descriptionEn: 'Hybrid inverter for commercial facilities that want flexible management between grid power, batteries, and solar arrays while maintaining operational continuity.',
        descriptionAr: 'انفرتر هجين للمنشآت التجارية التي تحتاج إلى إدارة مرنة بين الشبكة والبطاريات والطاقة الشمسية، مع الحفاظ على استمرارية التشغيل.',
        price: 33800,
        discountPrice: 31950,
        minOrderQuantity: 1,
        quantityAvailable: 14,
        specs: [
          { key: 'Output Power', value: '8kW continuous' },
          { key: 'PV Input', value: 'Dual MPPT' },
          { key: 'Battery Type', value: 'Lead-acid and lithium support' },
          { key: 'Display', value: 'LCD monitoring panel' }
        ]
      },
      {
        nameEn: 'Smart Rack PDU Unit',
        nameAr: 'وحدة توزيع طاقة ذكية للرفوف',
        descriptionEn: 'Intelligent PDU for data and control racks with branch monitoring, overload alerts, and clean distribution for modern infrastructure environments.',
        descriptionAr: 'وحدة توزيع طاقة ذكية لرفوف البيانات والتحكم مع مراقبة الفروع والتنبيه عند الحمل الزائد وتوزيع منظم للطاقة في البيئات الحديثة.',
        price: 5400,
        discountPrice: 4980,
        minOrderQuantity: 2,
        quantityAvailable: 54,
        specs: [
          { key: 'Outlet Count', value: '12 IEC outlets' },
          { key: 'Monitoring', value: 'Per-branch current monitoring' },
          { key: 'Mounting', value: '1U rack mount' },
          { key: 'Alerts', value: 'Overload email/SNMP alerts' }
        ]
      },
      {
        nameEn: 'Industrial Surge Protection Kit',
        nameAr: 'طقم حماية من زيادة الجهد الصناعي',
        descriptionEn: 'A complete surge protection kit for industrial panels and sensitive equipment, designed to reduce risk from unstable incoming power and transient events.',
        descriptionAr: 'طقم حماية متكامل من ارتفاعات الجهد للوحـات الصناعية والمعدات الحساسة، ومصمم لتقليل المخاطر الناتجة عن اضطرابات التغذية والنبضات العابرة.',
        price: 2950,
        discountPrice: 2690,
        minOrderQuantity: 5,
        quantityAvailable: 96,
        specs: [
          { key: 'Protection Class', value: 'Type II surge protection' },
          { key: 'Nominal Voltage', value: '400V AC' },
          { key: 'Response Time', value: '< 25 ns' },
          { key: 'Installation', value: 'Panel rail mounting' }
        ]
      }
    ]
  },
  {
    order: 2,
    products: [
      {
        nameEn: 'Managed PoE Switch 24 Port',
        nameAr: 'سويتش مُدار PoE بعدد 24 منفذ',
        descriptionEn: 'Enterprise-grade managed switch with PoE support for IP cameras, access points, and branch connectivity in industrial and commercial deployments.',
        descriptionAr: 'سويتش مُدار بمواصفات احترافية مع دعم PoE لتغذية الكاميرات ونقاط الوصول وأجهزة الربط داخل المنشآت الصناعية والتجارية.',
        price: 12800,
        discountPrice: 11750,
        minOrderQuantity: 1,
        quantityAvailable: 33,
        specs: [
          { key: 'Ports', value: '24x Gigabit PoE + 4x SFP uplink' },
          { key: 'PoE Budget', value: '370W total budget' },
          { key: 'Management', value: 'VLAN, QoS, ACL, SNMP' },
          { key: 'Enclosure', value: 'Rackmount metal housing' }
        ]
      },
      {
        nameEn: 'Industrial Gigabit Router',
        nameAr: 'راوتر صناعي جيجابت',
        descriptionEn: 'Durable industrial router for factories, remote sites, and branch connectivity with secure WAN access, dual uplink support, and stable network routing.',
        descriptionAr: 'راوتر صناعي متين للمصانع والمواقع البعيدة والفروع، ويوفر وصولاً آمنًا إلى الشبكات الخارجية مع دعم اتصال مزدوج واستقرار في التوجيه.',
        price: 9900,
        discountPrice: 9250,
        minOrderQuantity: 1,
        quantityAvailable: 26,
        specs: [
          { key: 'WAN Ports', value: 'Dual WAN failover' },
          { key: 'VPN', value: 'IPSec / OpenVPN support' },
          { key: 'Routing', value: 'Static and policy routing' },
          { key: 'Mounting', value: 'DIN rail / wall mount' }
        ]
      },
      {
        nameEn: 'Fiber SFP Uplink Module Set',
        nameAr: 'طقم وحدات SFP للألياف الضوئية',
        descriptionEn: 'Fiber uplink module set built for reliable long-distance backbone links between cabinets, buildings, and distribution switches.',
        descriptionAr: 'طقم وحدات ألياف ضوئية مخصص لروابط الـ backbone لمسافات أطول بين اللوحات والمباني والسويتشات الرئيسية والفرعية.',
        price: 2150,
        discountPrice: 1980,
        minOrderQuantity: 4,
        quantityAvailable: 140,
        specs: [
          { key: 'Data Rate', value: '1.25Gbps' },
          { key: 'Fiber Type', value: 'Single-mode LC' },
          { key: 'Distance', value: 'Up to 10km' },
          { key: 'Operating Temp', value: '-20C to 70C' }
        ]
      },
      {
        nameEn: 'Outdoor Wireless Bridge Kit',
        nameAr: 'طقم جسر لاسلكي خارجي',
        descriptionEn: 'Outdoor bridge solution for connecting warehouses, gates, and remote buildings without trenching, while maintaining stable point-to-point throughput.',
        descriptionAr: 'حل جسر لاسلكي خارجي لربط المخازن والبوابات والمباني البعيدة دون أعمال حفر، مع الحفاظ على سعة اتصال مستقرة من نقطة إلى نقطة.',
        price: 7600,
        discountPrice: 7090,
        minOrderQuantity: 1,
        quantityAvailable: 22,
        specs: [
          { key: 'Wireless Standard', value: '5GHz point-to-point bridge' },
          { key: 'Range', value: 'Up to 5km line of sight' },
          { key: 'Throughput', value: '867Mbps' },
          { key: 'Protection', value: 'IP65 outdoor enclosure' }
        ]
      },
      {
        nameEn: 'Rackmount Firewall Appliance',
        nameAr: 'جهاز فايروول راك احترافي',
        descriptionEn: 'Security appliance for business networks requiring segmented access control, intrusion inspection, and safer connectivity between offices and cloud services.',
        descriptionAr: 'جهاز أمني احترافي للشبكات التجارية التي تحتاج إلى سياسات وصول مقسمة، وفحص للحركة، وربط أكثر أمانًا بين المكاتب والخدمات السحابية.',
        price: 28700,
        discountPrice: 26900,
        minOrderQuantity: 1,
        quantityAvailable: 9,
        specs: [
          { key: 'Interfaces', value: '8x Gigabit RJ45' },
          { key: 'Security Features', value: 'IDS, VPN, web filtering' },
          { key: 'Form Factor', value: '1U rack appliance' },
          { key: 'Performance', value: 'Up to 3Gbps firewall throughput' }
        ]
      }
    ]
  },
  {
    order: 3,
    products: [
      {
        nameEn: 'Biometric Access Control Terminal',
        nameAr: 'جهاز تحكم دخول بالبصمة',
        descriptionEn: 'Biometric terminal for offices, factories, and secured rooms, combining fingerprint and card verification with attendance-ready reporting.',
        descriptionAr: 'جهاز تحكم دخول بالبصمة للمكاتب والمصانع والغرف المؤمنة، ويجمع بين البصمة وبطاقات التعريف مع تقارير جاهزة للحضور والانصراف.',
        price: 8450,
        discountPrice: 7890,
        minOrderQuantity: 1,
        quantityAvailable: 38,
        specs: [
          { key: 'Authentication', value: 'Fingerprint + RFID card' },
          { key: 'Capacity', value: '3000 users / 100000 logs' },
          { key: 'Connectivity', value: 'TCP/IP and USB' },
          { key: 'Use Case', value: 'Access control and attendance' }
        ]
      },
      {
        nameEn: 'IP Video Door Station',
        nameAr: 'وحدة إنتركم مرئي IP',
        descriptionEn: 'IP-based video door station for commercial buildings and gated facilities, enabling visitor verification, remote answering, and secure entry workflows.',
        descriptionAr: 'وحدة إنتركم مرئي تعمل عبر IP للمباني التجارية والمنشآت المؤمنة، وتتيح التحقق من الزوار والرد عن بُعد وتنظيم الدخول بشكل آمن.',
        price: 11250,
        discountPrice: 10400,
        minOrderQuantity: 1,
        quantityAvailable: 17,
        specs: [
          { key: 'Camera', value: '2MP wide-angle camera' },
          { key: 'Audio', value: 'Two-way echo-cancelled audio' },
          { key: 'Network', value: 'PoE and SIP compatible' },
          { key: 'Protection', value: 'IK08 / IP65' }
        ]
      },
      {
        nameEn: 'Smart Turnstile Controller',
        nameAr: 'وحدة تحكم للبوابات الدوارة الذكية',
        descriptionEn: 'Turnstile control system built for secure entrances in industrial sites, campuses, and business parks where controlled movement is required.',
        descriptionAr: 'نظام تحكم للبوابات الدوارة مخصص للمداخل المؤمنة في المواقع الصناعية والجامعات والمجمعات التجارية التي تحتاج إلى تنظيم الحركة بدقة.',
        price: 15400,
        discountPrice: 14650,
        minOrderQuantity: 1,
        quantityAvailable: 11,
        specs: [
          { key: 'Access Inputs', value: 'Card, QR, biometric integration' },
          { key: 'Control Logic', value: 'Bidirectional passage control' },
          { key: 'Safety', value: 'Emergency release support' },
          { key: 'Integration', value: 'Dry contact and TCP/IP APIs' }
        ]
      },
      {
        nameEn: 'Fire Alarm Control Panel',
        nameAr: 'لوحة تحكم إنذار حريق',
        descriptionEn: 'Addressable fire alarm panel designed for warehouses, factories, and facilities that need centralized alarm visibility and dependable event handling.',
        descriptionAr: 'لوحة إنذار حريق Addressable للمخازن والمصانع والمنشآت التي تحتاج إلى رؤية مركزية للإنذارات ومعالجة موثوقة للأحداث.',
        price: 23600,
        discountPrice: 22150,
        minOrderQuantity: 1,
        quantityAvailable: 13,
        specs: [
          { key: 'Loops', value: '2 addressable loops' },
          { key: 'Device Capacity', value: 'Up to 500 field devices' },
          { key: 'Display', value: 'Backlit LCD panel' },
          { key: 'Compliance', value: 'Industrial fire safety ready' }
        ]
      },
      {
        nameEn: 'Warehouse Safety Beacon System',
        nameAr: 'نظام منارات تحذير للمخازن',
        descriptionEn: 'Visual warning beacon system for warehouse aisles, loading zones, and restricted areas to improve operational safety and hazard awareness.',
        descriptionAr: 'نظام منارات ضوئية للتحذير في ممرات المخازن ومناطق التحميل والمناطق المقيدة، بهدف تحسين السلامة التشغيلية ورفع الوعي بالمخاطر.',
        price: 4680,
        discountPrice: 4290,
        minOrderQuantity: 3,
        quantityAvailable: 68,
        specs: [
          { key: 'Signal Type', value: 'Flashing LED + buzzer' },
          { key: 'Voltage', value: '24V DC industrial standard' },
          { key: 'Mounting', value: 'Pole and wall mount support' },
          { key: 'Visibility', value: 'High-brightness 360-degree alert' }
        ]
      }
    ]
  }
];

const slugify = (value) =>
  `${value || ''}`
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

const buildImageUrl = (title, variant = 'main') => {
  const text = encodeURIComponent(title.slice(0, 42));
  const palette = variant === 'main' ? '0f172a/ffffff' : '155e75/f8fafc';
  return `https://placehold.co/1200x900/${palette}.webp?text=${text}`;
};

const connect = () =>
  mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 3306),
    ssl: { rejectUnauthorized: false },
    namedPlaceholders: true
  });

const resolveVendor = async (connection) => {
  const [rows] = await connection.execute(
    `
      SELECT u.id AS user_id, u.email, vp.id AS vendor_id
      FROM users u
      JOIN vendor_profiles vp ON vp.user_id = u.id
      WHERE u.email = :email
      LIMIT 1
    `,
    { email: TARGET_VENDOR_EMAIL }
  );

  return rows[0] || null;
};

const resolveCategories = async (connection) => {
  const [rows] = await connection.execute(
    `
      SELECT id, name_ar, name_en, slug
      FROM categories
      WHERE deleted_at IS NULL
      ORDER BY id
      LIMIT 4
    `
  );

  return rows;
};

const ensureVendorCategories = async (connection, vendorId, categoryIds) => {
  for (const categoryId of categoryIds) {
    await connection.execute(
      `
        INSERT IGNORE INTO vendor_category_junction (vendor_id, category_id)
        VALUES (:vendorId, :categoryId)
      `,
      { vendorId, categoryId }
    );
  }
};

const buildCatalog = (categories, vendorId) =>
  categories.flatMap((category, categoryIndex) => {
    const bundle = categoryTemplates[categoryIndex]?.products || [];
    return bundle.map((entry, productIndex) => {
      const baseSlug = slugify(`${entry.nameEn}-vendor-${vendorId}`);
      return {
        ...entry,
        vendorId,
        categoryId: category.id,
        slug: baseSlug,
        images: [
          {
            imageUrl: buildImageUrl(entry.nameEn, 'main'),
            publicId: `seed/vendor-${vendorId}/${baseSlug}/main`,
            isMain: 1
          },
          {
            imageUrl: buildImageUrl(`${entry.nameEn} details`, 'secondary'),
            publicId: `seed/vendor-${vendorId}/${baseSlug}/detail-${productIndex + 1}`,
            isMain: 0
          }
        ]
      };
    });
  });

const insertCatalog = async () => {
  const pool = connect();
  const connection = await pool.getConnection();

  try {
    const vendor = await resolveVendor(connection);
    if (!vendor?.vendor_id) {
      throw new Error(`Vendor account not found for ${TARGET_VENDOR_EMAIL}`);
    }

    const categories = await resolveCategories(connection);
    if (categories.length < 4) {
      throw new Error(`Expected at least 4 categories, found ${categories.length}`);
    }

    await connection.beginTransaction();
    await ensureVendorCategories(connection, vendor.vendor_id, categories.map((category) => category.id));

    const catalog = buildCatalog(categories, vendor.vendor_id);
    const inserted = [];
    const skipped = [];

    for (const item of catalog) {
      const [existingRows] = await connection.execute(
        'SELECT id FROM products WHERE slug = :slug LIMIT 1',
        { slug: item.slug }
      );

      if (existingRows.length) {
        skipped.push({ slug: item.slug, productId: existingRows[0].id });
        continue;
      }

      const [result] = await connection.execute(
        `
          INSERT INTO products (
            vendor_id,
            category_id,
            name_ar,
            name_en,
            description_ar,
            description_en,
            slug,
            price,
            discount_price,
            min_order_quantity,
            quantity_available,
            avg_rating,
            review_count,
            location,
            specs,
            is_active,
            status,
            lifecycle_status,
            rejection_reason,
            deleted_at,
            created_at,
            updated_at,
            is_edited
          )
          VALUES (
            :vendorId,
            :categoryId,
            :nameAr,
            :nameEn,
            :descriptionAr,
            :descriptionEn,
            :slug,
            :price,
            :discountPrice,
            :minOrderQuantity,
            :quantityAvailable,
            0,
            0,
            :location,
            :specs,
            1,
            'ACTIVE',
            'APPROVED',
            NULL,
            NULL,
            NOW(),
            NOW(),
            0
          )
        `,
        {
          vendorId: item.vendorId,
          categoryId: item.categoryId,
          nameAr: item.nameAr,
          nameEn: item.nameEn,
          descriptionAr: item.descriptionAr,
          descriptionEn: item.descriptionEn,
          slug: item.slug,
          price: item.price,
          discountPrice: item.discountPrice,
          minOrderQuantity: item.minOrderQuantity,
          quantityAvailable: item.quantityAvailable,
          location: DEFAULT_LOCATION,
          specs: JSON.stringify(item.specs)
        }
      );

      const productId = result.insertId;
      for (const image of item.images) {
        await connection.execute(
          `
            INSERT INTO product_images (product_id, image_url, public_id, is_main, created_at, updated_at)
            VALUES (:productId, :imageUrl, :publicId, :isMain, NOW(), NOW())
          `,
          {
            productId,
            imageUrl: image.imageUrl,
            publicId: image.publicId,
            isMain: image.isMain
          }
        );
      }

      inserted.push({ id: productId, slug: item.slug, nameEn: item.nameEn, categoryId: item.categoryId });
    }

    await connection.commit();

    const [[summary]] = await connection.execute(
      `
        SELECT COUNT(*) AS totalProducts
        FROM products
        WHERE vendor_id = :vendorId
          AND deleted_at IS NULL
      `,
      { vendorId: vendor.vendor_id }
    );

    const [[imageSummary]] = await connection.execute(
      `
        SELECT COUNT(*) AS totalImages
        FROM product_images
        WHERE product_id IN (
          SELECT id FROM products WHERE vendor_id = :vendorId AND deleted_at IS NULL
        )
      `,
      { vendorId: vendor.vendor_id }
    );

    console.log(
      JSON.stringify(
        {
          vendor,
          categories: categories.map((category) => ({ id: category.id, slug: category.slug })),
          insertedCount: inserted.length,
          skippedCount: skipped.length,
          inserted,
          skipped,
          totals: {
            totalProducts: Number(summary?.totalProducts || 0),
            totalImages: Number(imageSummary?.totalImages || 0)
          }
        },
        null,
        2
      )
    );
  } catch (error) {
    try {
      await connection.rollback();
    } catch {}
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
};

insertCatalog().catch((error) => {
  console.error(error);
  process.exit(1);
});
