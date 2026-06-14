1. extension发布后有个警告需要修复：View container 'panel' does not exist and all views registered to it will be added to 'Explorer'.
2. 删除掉dirs相关的配置和add as dir功能，grep keyword, grep function都以当前的terminal路径为检索路径即可，
3. 插件占有的宽度太大，需要减少，+expr也放到同一行，思考怎么优雅地让用户进行基本设置，复杂设置才需要展开。
4. line ranges功能默认折叠不需要占地方，大部分时候用不上
5. time pattern默认支持[YY-MM-DD HH:mm:ss.SSS]，[YYYY-MM-DD HH:mm:ss.SSS], [sss.SSSSSS]等常用格式，最好能更智能一些，尽量不需要用户配置时间格式
6. grep group之间的顺序改成通过拖拽的方式调整顺序，上下箭头的功能改成editor的当前行下的上一个/下一个匹配的行
7. keyword功能的item选项里增加一个keyword是在已匹配的group文本里二次匹配还说基于全部文档匹配，默认基于已匹配的group文件进行keyword匹配。