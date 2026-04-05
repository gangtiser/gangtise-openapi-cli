const e=function(){return typeof window<"u"?window.location.host.replace("-platform",""):"open.gangtise.com"},t=e(),a={title:"accesstToken获取",description:"获取accessToken。（注：V2接口返回的accessToken已经携带了Bearer 前缀，后续调用接口不需要再拼接）",url:"https://"+t+"/application/auth/oauth/open/loginV2",method:"POST",params:[{name:"accessKey",type:"String",desc:"开发账号ak",required:"是"},{name:"secretKey",type:"String",desc:"开发账号sk",required:"是"}],response:[{name:"accessToken",type:"String",desc:"开发账号token"},{name:"expiresIn",type:"Long",desc:"有效时间（单位秒）"},{name:"uid",type:"Integer",desc:"开发账号的uid"},{name:"userName",type:"String",desc:"开发账号名称"},{name:"tenantId",type:"Integer",desc:"开发账号所属租户Id"},{name:"time",type:"Integer",desc:"开发账号登录时间（时间戳，单位为秒）"}],reqExample:{accessKey:"your accessKey",secretKey:"your secretKey"},resExample:`{
        "code": "000000",
        "msg": "请求成功",
        "status": true,
        "data": {
            "accessToken": "3d08a305-ae17-4540-b5ee-976a50219287",
            "expiresIn": 14400,
            "uid": 290,
            "userName": "一号开发者",
            "tenantId": 183,
            "time": 1679031461
        }
    }`,remark:"更多返回错误代码请看首页的错误代码描述"},c={title:"统一返回说明",returnBody:`{
      "code": "000000",
      "msg": "请求成功",
      "status": true,
      "data": ""
    }`,response:[{name:"code",type:"String",desc:"返回错误编码。 000000代表正常返回，其余代表异常"},{name:"msg",type:"String",desc:"请求返回提示信息"},{name:"status",type:"Boolean",desc:"请求处理结果，true：正常 false：异常"},{name:"data",type:"Object",desc:"接口返回数据"}]},n={title:"错误码",params:[{code:"999999",desc:"系统错误"},{code:"999997",desc:"未开通接口权限"},{code:"999995",desc:"积分不足"},{code:"900002",desc:"uid为空"},{code:"900001",desc:"请求参数为空"},{code:"8000014",desc:"开发账号AK错误"},{code:"8000015",desc:"开发账号SK错误"},{code:"8000016",desc:"开发账号状态异常"},{code:"8000018",desc:"开发账号已到期"},{code:"903301",desc:"今日调用次数已达到上限"}]};export{n as e,t as h,c as r,a as t};
