// ============================================================================
// 识别食材 → 《中国食物成分表》食物的匹配（纯本地）。
//
// 识别出的食材名带刀工和状态（青椒丝、带皮五花肉块、煎蛋），成分表的名字是原料
// （甜椒［灯笼椒、柿子椒］、猪肉（奶面）［硬五花］）。匹配分四步，先到先得：
//   1. 常用食材对照表 CURATED：逐条人工指定成分表编码，覆盖实际记录里出现过的大部分食材；
//   2. 与成分表主名或别名完全相同（土豆 → 马铃薯［土豆、洋芋］），优先「代表值」；
//   3. 去掉刀工后缀（丝/片/块/段…）与状态前缀（新鲜/带皮/卤…）后重复 1、2；
//   4. 名字里包含某个对照表词或成分表主名（取最长），并核对肉的种类不冲突。
// 都对不上就不计入营养，页面会显示「未匹配」，不会拿别的食物硬凑。
//
// 两处折算（都写进 reason，页面可见）：
//   - 带骨、带壳的肉禽鱼虾：估重包含骨头和壳，按成分表「食部」折成可食部再计算；
//   - 粉丝、腐竹这类按干品收录的食物：盘里是泡发或煮过的，按吸水倍数折回干重。
// 成分表多为生重数据，烹调中的水分变化与用油、用盐未计入，结果用于饮食记录参考。
// ============================================================================

import { NutritionFood, findNutritionFood, foodsByBaseName, foodsByFullName, nutritionBaseNames } from '../data/nutritionDb';
import { normalize } from '../utils/similarity';

export interface NutritionMatch {
  /** 识别食材名（原样） */
  query: string;
  food: NutritionFood | null;
  /** 盘中重量 → 成分表口径重量的系数（可食部 × 干湿折算），未匹配时为 0 */
  factor: number;
  /** 一句话说明，如「按「猪小排（杜长大猪）」计，带骨按可食部 70% 折算」 */
  reason: string;
}

interface Curated {
  code: string;
  /** 干品折算：盘中重量 × dry = 干重 */
  dry?: number;
  note?: string;
}

const c = (code: string, dry?: number, note?: string): Curated => ({ code, dry, note });
const RICE = c('012401x');
const NOODLE = c('011317');
const PORRIDGE = c('012404');
const PORK = c('081101x');
const LEAN_PORK = c('081110x');
const BELLY = c('081108');
const BEEF = c('082101x');
const CHICKEN = c('091101x');
const DUCK = c('092101x');
const EGG = c('111101x');
const FISH = c('121102', undefined, '未注明鱼种，按草鱼计');
const SHRIMP = c('122106');
const GLASS_NOODLE = c('022201', 0.3, '粉丝按泡发煮熟后约 3.3 倍重折回干重');
const GARLIC = c('044101');
const SCALLION = c('044205');
const GINGER = c('047301');
const OIL = c('192014');

/** 常用食材对照表：键为归一化后的食材名（去掉刀工后缀前、后两种写法都可） */
const CURATED: Record<string, Curated> = {
  // 主食：盘里的都是熟的，优先用成分表的熟制品条目
  米饭: RICE, 白米饭: RICE, 大米饭: RICE, 大米: RICE, 稻米: RICE, 白饭: RICE, 二米饭: RICE,
  紫米饭: c('012401x', undefined, '成分表无紫米饭，按米饭（蒸）近似'), 紫米: c('012401x', undefined, '成分表无紫米饭，按米饭（蒸）近似'),
  黑米饭: c('012401x', undefined, '成分表无黑米饭，按米饭（蒸）近似'),
  粥: PORRIDGE, 白粥: PORRIDGE, 大米粥: PORRIDGE, 米粥: PORRIDGE, 稀饭: PORRIDGE,
  小米粥: c('015103'), 小米: c('015103', undefined, '按小米粥计'),
  玉米糁: c('012404', undefined, '成分表无玉米糁粥，按米粥近似'), 玉米粥: c('012404', undefined, '成分表无玉米粥，按米粥近似'),
  面条: NOODLE, 面: NOODLE, 宽面: NOODLE, 宽面条: NOODLE, 细面: NOODLE, 手擀面: NOODLE, 拉面: NOODLE, 挂面: NOODLE,
  汤面: NOODLE, 刀削面: NOODLE, 面片: NOODLE, 搓鱼面: NOODLE, 面鱼: NOODLE, 疙瘩汤: NOODLE, 面疙瘩: NOODLE,
  意面: c('011317', undefined, '按煮面条近似'), 意大利面: c('011317', undefined, '按煮面条近似'),
  龙须面: NOODLE, 鸡蛋面: NOODLE,
  馄饨皮: c('011305x', undefined, '按生面条（面皮）计'), 饺子皮: c('011305x', undefined, '按生面条（面皮）计'),
  面皮: c('011305x', undefined, '按生面条（面皮）计'),
  馒头: c('011404x'), 白馒头: c('011404x'), 花卷: c('011401'),
  饼: c('011403'), 大饼: c('011403'), 烙饼: c('011403'), 发面饼: c('011403'), 家常饼: c('011403'), 烧饼: c('011403'),
  油饼: c('011408'), 油条: c('011409'),
  面粉: c('011201x'), 小麦粉: c('011201x'), 面糊: c('011201x'),
  米粉: c('012410', 0.3, '米粉按煮后约 3.3 倍重折回干重'), 米线: c('012410', 0.3, '米线按煮后约 3.3 倍重折回干重'),
  河粉: c('012410', 0.3, '河粉按约 3.3 倍含水折回干米粉'),
  粉丝: GLASS_NOODLE, 粉条: c('022203', 0.3, '粉条按泡发煮熟后约 3.3 倍重折回干重'),
  宽粉: c('022203', 0.3, '宽粉按泡发煮熟后约 3.3 倍重折回干重'), 红薯粉: c('022203', 0.3, '红薯粉按泡发煮熟后约 3.3 倍重折回干重'),
  红薯粉条: c('022203', 0.3, '粉条按泡发煮熟后约 3.3 倍重折回干重'),
  玉米: c('013101'), 鲜玉米: c('013101'), 玉米棒: c('013101'), 玉米粒: c('013101'), 甜玉米: c('013101'),
  燕麦: c('019012'), 燕麦片: c('019012'),
  // 薯类
  土豆: c('021101'), 马铃薯: c('021101'), 洋芋: c('021101'),
  红薯: c('021205'), 地瓜: c('021205'), 甘薯: c('021205'), 紫薯: c('021205', undefined, '成分表无紫薯，按红心甘薯近似'),
  芋头: c('047203'), 芋艿: c('047203'), 山药: c('047104'), 铁棍山药: c('047104'), 莲藕: c('046010'), 藕: c('046010'),
  // 蔬菜
  青椒: c('043124'), 柿子椒: c('043124'), 甜椒: c('043124'), 彩椒: c('043124'), 红椒: c('043124'), 黄椒: c('043124'),
  红甜椒: c('043124'),
  尖椒: c('043123'), 青尖椒: c('043123'), 杭椒: c('043123'), 线椒: c('043123'), 螺丝椒: c('043123'), 青辣椒: c('043123'),
  辣椒: c('043109'), 红辣椒: c('043109'), 小米辣: c('043109'), 小米椒: c('043109'),
  干辣椒: c('043108'), 干红辣椒: c('043108'),
  洋葱: c('044301'), 葱头: c('044301'),
  蒜: GARLIC, 大蒜: GARLIC, 蒜瓣: GARLIC, 蒜末: GARLIC, 蒜蓉: GARLIC, 蒜头: GARLIC, 蒜片: GARLIC,
  蒜苗: c('044106'), 青蒜: c('044106'), 蒜苔: c('044107'), 蒜薹: c('044107'), 蒜黄: c('044105'),
  葱: SCALLION, 葱花: SCALLION, 小葱: SCALLION, 香葱: SCALLION, 葱段: SCALLION, 葱丝: SCALLION, 大葱: c('044206'),
  姜: GINGER, 生姜: GINGER, 老姜: GINGER, 子姜: c('047303'), 嫩姜: c('047303'),
  韭菜: c('044404'), 韭黄: c('044402'),
  芹菜: c('045331'), 香芹: c('045331'), 西芹: c('045332'), 水芹: c('046006'), 水芹菜: c('046006'),
  胡萝卜: c('041204'), 红萝卜: c('041204'), 白萝卜: c('041101'), 萝卜: c('041101'), 青萝卜: c('041113'),
  番茄: c('043119'), 西红柿: c('043119'), 圣女果: c('043120'), 小番茄: c('043120'), 樱桃番茄: c('043120'),
  茄子: c('043101x'), 长茄子: c('043101x'), 圆茄子: c('043101x'),
  豆角: c('042117'), 长豆角: c('042117'), 豇豆: c('042117'), 四季豆: c('042120'), 芸豆: c('042120'), 扁豆: c('042101'),
  荷兰豆: c('042106'), 甜豆: c('042122'), 毛豆: c('042109'), 毛豆仁: c('042109'), 青豆: c('042109'), 豌豆: c('042111'),
  豌豆苗: c('042208'), 豌豆尖: c('042112'),
  黄瓜: c('043208'), 冬瓜: c('043221'), 丝瓜: c('043228'), 苦瓜: c('043212'), 南瓜: c('043213'), 倭瓜: c('043213'),
  老南瓜: c('043213'), 贝贝南瓜: c('043227'), 西葫芦: c('043218'), 佛手瓜: c('043205'),
  白菜: c('045101x'), 大白菜: c('045101x'), 娃娃菜: c('045101x'), 白菜帮: c('045101x'), 白菜叶: c('045101x'),
  小白菜: c('045120'), 青菜: c('045120'), 鸡毛菜: c('045120'), 油菜: c('045125'), 上海青: c('045125'), 小油菜: c('045125'),
  菜心: c('045108'), 菜薹: c('045108'),
  圆白菜: c('045210'), 卷心菜: c('045210'), 包菜: c('045210'), 洋白菜: c('045210'), 甘蓝: c('045210'), 紫甘蓝: c('045211'),
  菠菜: c('045301'), 生菜: c('045333'), 球生菜: c('045333'), 油麦菜: c('045334'), 空心菜: c('045337'), 茼蒿: c('045321'),
  荠菜: c('045323'), 香菜: c('045317'), 芫荽: c('045317'), 苋菜: c('045319'), 木耳菜: c('045310'),
  芥菜: c('045205'), 雪里蕻: c('045205'), 雪菜: c('045205'), 芥兰: c('045215'), 芥蓝: c('045215'),
  菜花: c('045216'), 花菜: c('045216'), 花椰菜: c('045216'), 西兰花: c('045217'), 西蓝花: c('045217'),
  莴笋: c('045324'), 莴苣: c('045324'), 茭白: c('046007'), 芦笋: c('045415'), 秋葵: c('043126'), 香椿: c('048055'),
  百合: c('045409'), 鲜百合: c('045409'),
  豆芽: c('042206'), 绿豆芽: c('042206'), 黄豆芽: c('042202'),
  笋: c('045401'), 竹笋: c('045401'), 冬笋: c('045405'), 春笋: c('045404'), 玉米笋: c('013201'),
  荸荠: c('046008'), 马蹄: c('046008'), 酸菜: c('045119'), 黄花菜: c('045412'), 金针菜: c('045412'),
  // 菌藻
  木耳: c('051014'), 黑木耳: c('051014'), 水发木耳: c('051014'),
  银耳: c('051024', 0.12, '银耳按泡发后约 8 倍重折回干重'),
  香菇: c('051019'), 冬菇: c('051019'), 平菇: c('051015'), 杏鲍菇: c('051051'), 金针菇: c('051008'),
  蘑菇: c('051028'), 口蘑: c('051028'), 白蘑菇: c('051028'), 草菇: c('051001'),
  海带: c('052002'), 紫菜: c('052008'),
  // 水果
  西瓜: c('066201x'), 香蕉: c('065033'), 苹果: c('061101x'), 梨: c('061201x'), 桃: c('062101x'), 桃子: c('062101x'),
  葡萄: c('063101x'), 葡萄干: c('063107'), 橙: c('064101'), 橙子: c('064101'), 橘子: c('064203'), 桔子: c('064203'),
  柚子: c('064301'), 猕猴桃: c('063909'), 草莓: c('063910'), 樱桃: c('062902'), 芒果: c('065011'), 菠萝: c('065002'),
  哈密瓜: c('066103'), 火龙果: c('065023'), 荔枝: c('065010'), 青梅: c('062203'), 山楂: c('061301'), 柿子: c('063301'),
  红枣: c('062302'), 大枣: c('062302'), 枣: c('062302'), 鲜枣: c('062301'), 冬枣: c('062312'),
  // 坚果、种子
  花生: c('072004'), 花生米: c('072004'), 花生仁: c('072004'), 炸花生米: c('072022'), 油炸花生米: c('072022'),
  芝麻: c('072016'), 白芝麻: c('072016'), 黑芝麻: c('072017'), 杏仁: c('071014'), 核桃: c('071004'), 核桃仁: c('071004'),
  板栗: c('071010'), 栗子: c('071010'), 松仁: c('071013'), 松子: c('071013'),
  莲子: c('072009', 0.4, '莲子按煮后约 2.5 倍重折回干重'),
  // 大豆制品
  豆腐: c('031301x'), 北豆腐: c('031306'), 老豆腐: c('031306'), 嫩豆腐: c('031307'), 南豆腐: c('031307'),
  内酯豆腐: c('031304'), 豆干: c('031510x'), 豆腐干: c('031510x'), 香干: c('031510x'),
  豆皮: c('031527'), 豆腐皮: c('031527'), 油皮: c('031527'), 千张: c('031509'), 百叶: c('031509'),
  腐竹: c('031507', 0.35, '腐竹按泡发后约 3 倍重折回干重'), 油豆腐: c('031506'), 豆泡: c('031506'), 素鸡: c('031522'),
  豆腐丝: c('031501'), 豆浆: c('031405'), 面筋: c('011502'), 油面筋: c('011502'), 烤麸: c('031526'),
  // 畜肉
  猪肉: PORK, 肉: PORK, 肉片: PORK, 肉丝: PORK, 肉丁: PORK, 肉末: PORK, 肉沫: PORK, 肉馅: PORK, 猪肉馅: PORK, 猪肉末: PORK,
  瘦肉: LEAN_PORK, 猪瘦肉: LEAN_PORK, 精瘦肉: LEAN_PORK, 里脊: c('081129'), 猪里脊: c('081129'), 里脊肉: c('081129'),
  五花肉: BELLY, 猪五花肉: BELLY, 五花: BELLY, 肥肉: c('081102'), 肥膘: c('081102'),
  排骨: c('081131'), 猪排骨: c('081131'), 猪小排: c('081131'), 小排: c('081131'), 肋排: c('081131'), 猪肋排: c('081131'),
  猪蹄: c('081116'), 猪肘: c('081109'), 肘子: c('081109'), 猪肝: c('081214'), 猪肚: c('081213'), 猪血: c('081212'),
  血豆腐: c('081212'), 猪皮: c('081130'), 猪耳: c('081115'), 猪耳朵: c('081115'),
  腊肉: c('081305'), 培根: c('081304'), 香肠: c('081413'), 腊肠: c('081410'), 火腿: c('081420'), 火腿肠: c('081409'),
  午餐肉: c('081307'),
  牛肉: BEEF, 牛肉片: BEEF, 牛肉丝: BEEF, 牛肉粒: BEEF, 牛里脊: c('082112'), 牛柳: c('082112'), 牛腩: c('082116'),
  牛腱: c('082119'), 牛腱子: c('082119'), 牛腱肉: c('082119'), 牛腱子肉: c('082119'), 肥牛: c('082102'), 肥牛卷: c('082102'),
  牛筋: c('082306'), 牛蹄筋: c('082306'), 蹄筋: c('082306'), 牛肚: c('082203'),
  羊肉: c('083101x'), 羊排: c('083103'), 羊腿: c('083116'), 羊蝎子: c('083103'), 驴肉: c('084101'),
  // 禽肉
  鸡: CHICKEN, 鸡肉: CHICKEN, 鸡块: CHICKEN, 鸡丁: CHICKEN, 鸡丝: CHICKEN, 鸡肉丝: CHICKEN, 鸡肉片: CHICKEN, 土鸡: c('091102'),
  鸡胸肉: c('091112'), 鸡胸: c('091112'), 鸡胸脯肉: c('091112'), 鸡腿: c('091113'), 鸡腿肉: c('091113'), 琵琶腿: c('091113'),
  鸡翅: c('091114'), 鸡翅中: c('091114'), 鸡中翅: c('091114'), 鸡翅根: c('091114'), 鸡爪: c('091111'), 凤爪: c('091111'),
  鸡肝: c('091201'), 鸡心: c('091203'), 鸡胗: c('091205'), 鸡肫: c('091205'),
  鸭: DUCK, 鸭肉: DUCK, 鸭块: DUCK, 鸭胸: c('092104'), 鸭胸肉: c('092104'), 鸭舌: c('092205'), 鸭血: c('092207'),
  鹅: c('093101'), 鹅肉: c('093101'), 鸽: c('099003'), 鸽子: c('099003'), 乳鸽: c('099003'), 鸽肉: c('099003'),
  鹌鹑: c('099002'),
  // 蛋、奶
  鸡蛋: EGG, 蛋: EGG, 煎蛋: EGG, 炒蛋: EGG, 炒鸡蛋: EGG, 荷包蛋: EGG, 煮鸡蛋: EGG, 水煮蛋: EGG, 鸡蛋液: EGG, 蛋液: EGG,
  蛋花: EGG, 蛋皮: EGG, 鸡蛋饼: EGG, 柴鸡蛋: c('111104'), 土鸡蛋: c('111104'), 蛋清: c('111105'), 蛋白: c('111105'),
  蛋黄: c('111107'), 鸭蛋: c('112101'), 咸鸭蛋: c('112203'), 咸蛋: c('112203'), 咸蛋黄: c('112103'),
  皮蛋: c('112201'), 松花蛋: c('112201'), 鹌鹑蛋: c('114101'), 鹅蛋: c('113101'),
  牛奶: c('101101x'), 纯牛奶: c('101101x'), 鲜奶: c('101101x'), 酸奶: c('103001x'), 奶酪: c('104001'),
  // 鱼虾蟹贝
  鱼: FISH, 鱼肉: FISH, 鱼块: FISH, 鱼段: FISH, 整条鱼: FISH, 鱼片: FISH,
  草鱼: c('121102'), 鲤鱼: c('121111'), 鲫鱼: c('121123'), 鲈鱼: c('121226'), 海鲈鱼: c('121250'), 鳜鱼: c('121129'),
  桂鱼: c('121129'), 带鱼: c('121203'), 黄鱼: c('121242'), 小黄鱼: c('121242'), 大黄鱼: c('121211'), 黄花鱼: c('121242'),
  鳕鱼: c('121239'), 银鳕鱼: c('121239'), 鲳鱼: c('121233'), 平鱼: c('121233'), 鲢鱼: c('121132'), 胖头鱼: c('121128'),
  鳙鱼: c('121128'), 黑鱼: c('121116'), 鳝鱼: c('121107'), 黄鳝: c('121107'), 泥鳅: c('121114'), 三文鱼: c('121228'),
  鲅鱼: c('121223'), 银鱼: c('121117'), 罗非鱼: c('121112'), 鱼丸: c('121305'),
  虾: SHRIMP, 大虾: SHRIMP, 鲜虾: SHRIMP, 对虾: SHRIMP, 明虾: SHRIMP, 基围虾: c('122109'), 河虾: c('122108'),
  虾仁: c('122106', undefined, '按对虾的可食部计'), 鲜虾仁: c('122106', undefined, '按对虾的可食部计'),
  虾皮: c('122205'), 虾米: c('122201'), 海米: c('122201'),
  鱿鱼: c('129008'), 鱿鱼圈: c('129008'), 鱿鱼丝: c('129008'), 鱿鱼须: c('129008'), 墨鱼: c('129006'), 墨鱼仔: c('129006'),
  章鱼: c('129013'), 八爪鱼: c('129013'),
  螃蟹: c('123001'), 蟹: c('123001'), 海蟹: c('123001'), 梭子蟹: c('123004'), 河蟹: c('123002'), 大闸蟹: c('123002'),
  蟹棒: c('123301'), 蟹柳: c('123301'), 蟹足棒: c('123301'),
  扇贝: c('124111'), 生蚝: c('124108'), 牡蛎: c('124108'), 蚝: c('124108'), 蛤蜊: c('124201x'), 花蛤: c('124202'),
  蛏子: c('124103'), 鲍鱼: c('124101'), 海参: c('129001'), 水发海参: c('129003'), 海蜇: c('129004'), 海蜇皮: c('129004'),
  海蜇头: c('129005'),
  // 油脂
  食用油: OIL, 植物油: OIL, 色拉油: OIL, 油: OIL, 香油: c('192017'), 芝麻油: c('192017'), 花生油: c('192007'),
  猪油: c('191007'), 红油: c('192010'), 辣椒油: c('192010'),
  // 名字像肉或豆、其实是别的东西
  鸡腿菇: c('051028', undefined, '成分表无鲜鸡腿菇，按白蘑菇近似'), 黄豆苗: c('042202', undefined, '按黄豆芽近似'),
  黄豆嘴: c('042202', undefined, '按黄豆芽近似'), 花生芽: c('042202', undefined, '按黄豆芽近似'),
  牛筋面: c('011317', undefined, '按煮面条近似'), 意大利直面: c('011317', undefined, '按煮面条近似'),
  白肉: PORK, 乌鸡: c('091107'), 乌骨鸡: c('091107'), 目鱼: c('129006'), 香芋: c('047203'), 快菜: c('045120'),
  桃仁: c('071004'), 青笋: c('045324'),
};

/** 调料、汤汁、腌菜等：成分表（第一、二册）里没有，也不该拿相近的食物硬凑 */
const NO_MATCH = /^(酱汁|汤汁|汤|面汤|调料|水|酵母|橄榄菜|豆瓣酱|酱油|醋|盐|糖|料酒|蚝油|花椒|八角|桂皮|香叶|淀粉|芡汁|鱼鳔|鱼肚|花胶|其他.*)$/;
/** 饼、糕、包、饺这类成品：名字里含某种食材也不等于就是它（南瓜饼≠南瓜），兜底匹配时跳过 */
const COMPOSITE = /(饼|糕|酥|包|饺|卷|盒子|烧卖|烧麦|肠粉|锅贴|丸子|面包|蛋糕|月饼|布丁|果冻|山楂冻|蛋挞)/;

/** 最后一道兜底：只认出了是哪类东西（某种菇、某种梨、某种肉）时，按该类的代表食物近似 */
const GENERIC: { re: RegExp; code: string; label: string }[] = [
  { re: /(菇|蘑|菌)/, code: '051028', label: '菇类' },
  { re: /梨$/, code: '061201x', label: '梨' },
  { re: /桃$/, code: '062101x', label: '桃' },
  { re: /瘦.*猪|猪.*瘦/, code: '081110x', label: '猪瘦肉' },
  { re: /猪/, code: '081101x', label: '猪肉' },
  { re: /瘦.*牛|牛.*瘦/, code: '082108x', label: '牛瘦肉' },
  { re: /牛/, code: '082101x', label: '牛肉' },
  { re: /羊/, code: '083101x', label: '羊肉' },
  { re: /鸡/, code: '091101x', label: '鸡肉' },
  { re: /鸭/, code: '092101x', label: '鸭肉' },
  { re: /鹅/, code: '093101', label: '鹅肉' },
  { re: /虾/, code: '122106', label: '虾' },
  { re: /蟹/, code: '123001', label: '蟹' },
  { re: /鱼/, code: '121102', label: '鱼（草鱼）' },
];

const PREFIX = /^(新鲜|鲜活|鲜|带皮|带骨|去骨|去皮|整条|整只|卤|煎|炸|烤|红烧|水煮|清蒸|凉拌|熟)/;
const SUFFIX = /(丝|片|块|段|丁|末|条|碎|粒|圈|蓉|泥|瓣|帮|叶|梗|球)$/;
const DEVICE = /(高压锅|电压力锅|空气炸锅|电饭煲|砂锅)/g;
const MEAT_KIND = /[猪牛羊驴鸡鸭鹅鸽鱼虾蟹螺贝蛤蚌鳝鳗]/g;
/** 名字或备注暗示是干品、粉、罐头的成分表条目；识别名里没有这些字时不自动选它 */
const PROCESSED = /(干|脱水|粉|罐头|罐装|晒|腌|咸|熏|炸|烤|卤|酱|糖水|蜜饯)/;

function variants(name: string): string[] {
  const base = normalize(String(name || '').replace(/（[^）]*）|\([^)]*\)/g, '')).replace(DEVICE, '');
  const out: string[] = [];
  const add = (v: string) => { if (v && out.indexOf(v) < 0) out.push(v); };
  add(base);
  let s = base;
  for (let i = 0; i < 2; i += 1) {
    const next = s.replace(PREFIX, '');
    if (next === s || !next) break;
    s = next;
    add(s);
  }
  const strip = (v: string) => {
    let t = v;
    for (let i = 0; i < 2; i += 1) {
      const next = t.replace(SUFFIX, '');
      if (next === t || next.length < 1) break;
      t = next;
      add(t);
    }
  };
  strip(base);
  if (s !== base) strip(s);
  return out;
}

/** 同名多条时：代表值 > 标「鲜」的 > 编码靠前；识别名没说是干品时，不选干品、粉、罐头和干豆类 */
function pick(foods: NutritionFood[], query: string): NutritionFood | null {
  const allowProcessed = PROCESSED.test(query);
  let best: NutritionFood | null = null;
  let bestScore = -Infinity;
  foods.forEach((f, i) => {
    const qualifier = f.name.replace(/^[^（［]*/, '');
    if (!allowProcessed && (PROCESSED.test(qualifier) || f.category === '干豆类及制品' && !/(豆腐|豆浆|豆干|腐竹|豆皮|千张|素鸡)/.test(f.name))) return;
    const score = (/x$/.test(f.code) ? 2 : 0) + (/鲜/.test(qualifier) ? 1 : 0) - i * 0.001;
    if (score > bestScore) { best = f; bestScore = score; }
  });
  return best;
}

function kinds(text: string): string[] {
  return (text.match(MEAT_KIND) || []).filter((k, i, a) => a.indexOf(k) === i);
}

/** 肉的种类不冲突：识别名提到猪而候选是牛肉，就不要 */
function compatible(query: string, food: NutritionFood): boolean {
  const q = kinds(query);
  if (!q.length) return true;
  const f = kinds(food.name);
  return !f.length || f.some((k) => q.indexOf(k) >= 0);
}

const BONE_MEAT = /(带骨|骨|排|蹄|爪|翅|肘|腿(?!肉)|整只)/;
const BONE_POULTRY_FISH = /(带骨|骨|排|爪|翅|腿(?!肉)|整只|整条|块|段|带皮鱼|带鱼)/;
const BONELESS = /(去骨|无骨|净肉|腿肉|胸肉|肉丝|肉片|肉末|肉沫|肉馅|肉丁|肉糜|鱼片|鱼丸|鱼柳|鱼肉|虾仁|丸|柳|蓉|泥)/;

/** 估重里是否连着骨头或壳：是就按成分表的食部折算成可食部 */
function edibleFactor(query: string, food: NutritionFood): number {
  if (food.edible >= 100 || BONELESS.test(query)) return 1;
  const cat = food.category;
  if (cat === '畜肉类及制品') return BONE_MEAT.test(query) ? food.edible / 100 : 1;
  if (cat === '禽肉类及制品') return BONE_POULTRY_FISH.test(query) ? food.edible / 100 : 1;
  if (cat === '鱼虾蟹贝类') return food.edible / 100;
  return 1;
}

function build(query: string, food: NutritionFood, curated?: Curated): NutritionMatch {
  const edible = edibleFactor(query, food);
  const dry = curated && curated.dry ? curated.dry : 1;
  const notes: string[] = [];
  if (curated && curated.note) notes.push(curated.note);
  if (edible < 1) notes.push(`带骨或带壳，按可食部 ${Math.round(edible * 100)}% 折算`);
  return {
    query,
    food,
    factor: Math.round(edible * dry * 1000) / 1000,
    reason: `按《中国食物成分表》「${food.name}」计算${notes.length ? `；${notes.join('；')}` : ''}`,
  };
}

const memo: Record<string, NutritionMatch> = {};

/**
 * 为一种识别食材找成分表食物。
 * @param name 识别食材名，如「带皮五花肉块」
 * @param hint 质构库里匹配到的食材名，识别名本身对不上时再试它
 */
export function matchNutrition(name: string, hint?: string): NutritionMatch {
  const key = `${name}|${hint || ''}`;
  if (memo[key]) return memo[key];
  const result = matchOne(name) || (hint ? matchOne(hint, name) : null) || {
    query: name, food: null, factor: 0, reason: '《中国食物成分表》里没有对应的食物，未计入营养',
  };
  memo[key] = result;
  return result;
}

function matchOne(name: string, original?: string): NutritionMatch | null {
  const query = original || name;
  const vs = variants(name);
  if (!vs.length || NO_MATCH.test(vs[0])) return null;
  for (const v of vs) {
    const cur = CURATED[v];
    if (cur) {
      const food = findNutritionFood(cur.code);
      if (food) return build(query, food, cur);
    }
    const exact = pick(foodsByFullName(v), v) || pick(foodsByBaseName(v), v);
    if (exact && compatible(query, exact)) return build(query, exact);
  }
  // 兜底：名字里包含的最长对照表词或成分表主名（同样长时取靠前的，「黑鱼肉」取黑鱼而不是鱼肉）
  const head = vs[0] || '';
  type Found = { len: number; at: number; food: NutritionFood; cur?: Curated };
  let best: Found | null = null;
  const consider = (k: string, food: NutritionFood | null | undefined, cur?: Curated) => {
    const at = head.indexOf(k);
    if (k.length < 2 || at < 0 || !food || !compatible(query, food)) return;
    if (COMPOSITE.test(head) && !COMPOSITE.test(k)) return;
    const b = best as Found | null;
    if (b && (b.len > k.length || (b.len === k.length && b.at <= at))) return;
    best = { len: k.length, at, food, cur };
  };
  Object.keys(CURATED).forEach((k) => consider(k, findNutritionFood(CURATED[k].code), CURATED[k]));
  nutritionBaseNames().forEach(({ key: k }) => { if (k.length >= 2 && head.indexOf(k) >= 0) consider(k, pick(foodsByBaseName(k), head)); });
  const found = best as Found | null;
  if (found) return build(query, found.food, found.cur);
  if (COMPOSITE.test(head)) return null;
  for (const g of GENERIC) {
    if (!g.re.test(head)) continue;
    const food = findNutritionFood(g.code);
    if (food) return build(query, food, { code: g.code, note: `成分表没有这一品种，按${g.label}近似` });
  }
  return null;
}
