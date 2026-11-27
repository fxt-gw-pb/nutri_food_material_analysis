// 必须最先求值：页面模块在被 import 时就会调用全局 Page()，页面方法运行时会调用 wx.*。
import { registerPageGlobal } from './page';
import { installGlobals } from './wx';

registerPageGlobal();
installGlobals();
